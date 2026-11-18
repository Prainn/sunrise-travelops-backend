import { DataSource } from 'typeorm';
import { VISIT_COLUMNS } from './website-visits-reader';

type CopyRow = Record<(typeof VISIT_COLUMNS)[number], string | null> & {
  id: string;
  whatsapp_reference: string;
};
export interface VisitCopyReport {
  sourceRows: number;
  targetRowsBefore: number;
  identical: number;
  missingIds: string[];
  inserted: number;
}
export class VisitCopyConflict extends Error {
  constructor(
    readonly conflicts: {
      sourceId: string;
      targetId: string;
      kind: 'uuid' | 'reference';
    }[],
  ) {
    super(`Visit source conflict: ${conflicts.length} records; no rows copied`);
  }
}

// Text casts preserve PostgreSQL timestamp precision, including sub-millisecond digits.
const projection = VISIT_COLUMNS.map(
  (column) => `${column}::text AS ${column}`,
).join(',');
async function connectionIdentity(db: DataSource) {
  const [identity] = await db.query<
    { database: string; address: string; port: number }[]
  >(
    'SELECT current_database() AS database, inet_server_addr()::text AS address, inet_server_port() AS port',
  );
  return identity;
}

/** Append-only, default dry run. Never copy confirmations, inquiries, roles or migrations. */
export async function copyVisitSource(
  source: DataSource,
  target: DataSource,
  apply = false,
): Promise<VisitCopyReport> {
  const [from, to] = await Promise.all([
    connectionIdentity(source),
    connectionIdentity(target),
  ]);
  if (JSON.stringify(from) === JSON.stringify(to))
    throw new Error('Source and target must be different databases');
  const read = source.createQueryRunner(),
    write = target.createQueryRunner();
  try {
    await read.connect();
    await write.connect();
    await read.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await write.query(
      apply ? 'BEGIN' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
    );
    for (const runner of [read, write]) {
      await runner.query("SET LOCAL timezone='UTC'");
      await runner.query("SET LOCAL statement_timeout='30s'");
      await runner.query("SET LOCAL lock_timeout='5s'");
    }
    const schemas = await Promise.all(
      [read, write].map((runner) =>
        runner.manager.query<
          { column_name: string; udt_name: string; is_nullable: string }[]
        >(
          "SELECT column_name,udt_name,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='lynx_visits' ORDER BY column_name",
        ),
      ),
    );
    if (
      schemas.some(
        (schema) =>
          schema.length !== VISIT_COLUMNS.length ||
          schema.some(
            (column) =>
              !(VISIT_COLUMNS as readonly string[]).includes(
                column.column_name,
              ),
          ),
      ) ||
      JSON.stringify(schemas[0]) !== JSON.stringify(schemas[1])
    )
      throw new Error(
        'Visit source schemas must match the explicit 17-column contract',
      );
    if (apply)
      await write.query(
        'LOCK TABLE public.lynx_visits IN SHARE ROW EXCLUSIVE MODE',
      );
    const incoming = await read.manager.query<CopyRow[]>(
      `SELECT ${projection} FROM public.lynx_visits ORDER BY id`,
    );
    const existing = await write.manager.query<CopyRow[]>(
      `SELECT ${projection} FROM public.lynx_visits ORDER BY id`,
    );
    const byId = new Map(existing.map((row) => [row.id, row]));
    const byReference = new Map(
      existing.map((row) => [row.whatsapp_reference, row]),
    );
    const conflicts: VisitCopyConflict['conflicts'] = [];
    const missing: CopyRow[] = [];
    let identical = 0;
    for (const row of incoming) {
      const idMatch = byId.get(row.id),
        referenceMatch = byReference.get(row.whatsapp_reference);
      if (idMatch) {
        if (VISIT_COLUMNS.every((column) => idMatch[column] === row[column]))
          identical++;
        else
          conflicts.push({
            sourceId: row.id,
            targetId: idMatch.id,
            kind: 'uuid',
          });
      } else if (referenceMatch) {
        conflicts.push({
          sourceId: row.id,
          targetId: referenceMatch.id,
          kind: 'reference',
        });
      } else missing.push(row);
    }
    if (conflicts.length) throw new VisitCopyConflict(conflicts);
    if (apply && missing.length) {
      // Explicit columns and typed JSON values preserve IDs, timestamps, nulls and fingerprints.
      // No ON CONFLICT: a conflict must fail the entire transaction.
      const columns = VISIT_COLUMNS.join(',');
      await write.query(
        `INSERT INTO public.lynx_visits (${columns})
        SELECT ${columns} FROM jsonb_populate_recordset(NULL::public.lynx_visits,$1::jsonb)`,
        [JSON.stringify(missing)],
      );
      const copied = await write.manager.query<CopyRow[]>(
        `SELECT ${projection} FROM public.lynx_visits WHERE id=ANY($1::uuid[])`,
        [missing.map((row) => row.id)],
      );
      const checked = new Map(copied.map((row) => [row.id, row]));
      if (
        missing.some(
          (row) =>
            !checked.has(row.id) ||
            VISIT_COLUMNS.some(
              (column) => checked.get(row.id)![column] !== row[column],
            ),
        )
      )
        throw new Error(
          'Post-copy verification failed; transaction rolled back',
        );
    }
    await write.query('COMMIT');
    return {
      sourceRows: incoming.length,
      targetRowsBefore: existing.length,
      identical,
      missingIds: missing.map((row) => row.id),
      inserted: apply ? missing.length : 0,
    };
  } finally {
    await Promise.allSettled(
      [write, read].map(async (runner) => {
        try {
          if (!runner.isReleased) await runner.query('ROLLBACK');
        } finally {
          await runner.release();
        }
      }),
    );
  }
}
