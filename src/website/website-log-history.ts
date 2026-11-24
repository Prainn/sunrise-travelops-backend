import type { EntityManager } from 'typeorm';
import type {
  WebsiteBusinessUnit,
  WebsiteInquiryLog,
  WebsiteLogChange,
  WebsiteLogReference,
} from './website.types';
import {
  blankNames,
  renderLogNames,
  displayLogChanges,
} from './website-log-display';
import type { LogNames, LogSide, RefKind } from './website-log-display';
import { replayLog, targetNames } from './website-log-evidence';
import type { NameCapture } from './website-log-evidence';

interface Capture {
  captured: NameCapture;
  unit: WebsiteBusinessUnit;
  inquiry: boolean;
  occurredAt?: string;
}
const configGroups: Partial<Record<RefKind, string>> = {
  city: 'cities',
  attraction: 'attractions',
  route: 'routes',
  configHotel: 'hotels',
};

/** Resolve only referenced records, batching both sides and all page rows by immutable version. */
async function fillCatalog(
  manager: EntityManager,
  batch: Capture[],
  writing: boolean,
) {
  const requests = batch.flatMap(
    ({ captured, unit, inquiry, occurredAt }, idx) =>
      captured.requests.flatMap(({ kind, id, side, version }) => {
        const grp = configGroups[kind];
        if (!grp && !writing) return [];
        if (grp && version === undefined && !inquiry) return [];
        return [
          {
            idx,
            unit,
            side,
            kind,
            id,
            grp: grp ?? null,
            ver: version ?? null,
            at: occurredAt ?? null,
          },
        ];
      }),
  );
  if (!requests.length) return;
  // Public hotel/restaurant data is used exclusively at the time of writing.
  const shared = writing
    ? `
    UNION ALL
    SELECT r.idx,r.side,r.kind,r.id,h.name,NULL FROM req r JOIN resource_hotels h ON h.id::text=r.id
      WHERE r.kind='sharedHotel' AND h.deleted_at IS NULL
    UNION ALL
    SELECT r.idx,r.side,r.kind,r.id,m.name,NULL FROM req r JOIN resource_restaurants m ON m.id::text=r.id
      WHERE r.kind='restaurant' AND m.deleted_at IS NULL`
    : '';
  const inquiryVersion = writing
    ? '(SELECT c.version FROM website_config_current c WHERE c.business_unit=g.unit)'
    : '(SELECT v.version FROM website_config_versions v WHERE v.business_unit=g.unit AND v.created_at<=g.at ORDER BY v.created_at DESC,v.version DESC LIMIT 1)';
  const rows = await manager.query<
    Array<{
      idx: number;
      side: LogSide;
      kind: RefKind;
      id: string;
      zh: string | null;
      en: string | null;
    }>
  >(
    `WITH req AS (
       SELECT * FROM jsonb_to_recordset($1::jsonb)
         AS r(idx int,unit text,side text,kind text,id text,grp text,ver int,at timestamptz)
     ), bindings AS MATERIALIZED (
       SELECT g.*,COALESCE(g.ver,${inquiryVersion}) AS bound
       FROM (SELECT DISTINCT unit,ver,at,grp FROM req WHERE grp IS NOT NULL) g
     ), wanted AS (
       SELECT r.*,b.bound FROM req r JOIN bindings b ON (b.unit,b.grp)=(r.unit,r.grp)
         AND b.ver IS NOT DISTINCT FROM r.ver AND b.at IS NOT DISTINCT FROM r.at
     ), labels AS MATERIALIZED (
       SELECT w.unit,w.bound,w.grp,j->>'id' AS id,j->>'nameZh' AS zh,j->>'nameEn' AS en
       FROM (SELECT unit,bound,grp,array_agg(DISTINCT id) ids FROM wanted GROUP BY unit,bound,grp) w
       JOIN website_config_versions v ON (v.business_unit,v.version)=(w.unit,w.bound)
       CROSS JOIN LATERAL jsonb_array_elements(v.config->w.grp) j WHERE j->>'id'=ANY(w.ids)
     )
     SELECT r.idx,r.side,r.kind,r.id,l.zh,l.en FROM wanted r JOIN labels l
       ON (l.unit,l.bound,l.grp,l.id)=(r.unit,r.bound,r.grp,r.id) ${shared}`,
    [JSON.stringify(requests)],
  );
  for (const row of rows) {
    if (!row.zh && !row.en) continue;
    const ref: WebsiteLogReference = { ref: row.kind };
    if (row.zh) ref.nameZh = row.zh;
    if (row.en) ref.nameEn = row.en;
    batch[row.idx].captured.names[row.side][row.kind + ':' + row.id] = ref;
  }
}

export async function captureLogNames(
  manager: EntityManager,
  changes: WebsiteLogChange[],
  unit: WebsiteBusinessUnit,
  before: object | undefined,
  after: object,
): Promise<LogNames | undefined> {
  const captured = targetNames(changes, before, after);
  const { names } = captured;
  if (
    !changes.some((c) => c.path.endsWith('.eventOrder')) &&
    !names.orders &&
    !Object.keys(names.before).length &&
    !Object.keys(names.after).length
  )
    return;
  await fillCatalog(
    manager,
    [{ captured, unit, inquiry: !('inquiryId' in after) }],
    true,
  );
  return names;
}

export type StoredWebsiteLog = Omit<WebsiteInquiryLog, 'displayChanges'> & {
  logNames: LogNames | null;
};
function needsHistory(changes: WebsiteLogChange[]) {
  if (changes.some((c) => c.path.endsWith('.eventOrder'))) return true;
  let needed = false;
  displayLogChanges(changes, (_side, ref) => {
    needed = true;
    return { ref };
  });
  return needed;
}

/** Only read the histories of targets already authorized by the main page query.
 * The DB tuple keeps sub-millisecond precision. Filters and pagination do not
 * cut off earlier evidence; later edits can never supply a name for an old row. */
export async function presentWebsiteLogs(
  manager: EntityManager,
  rows: StoredWebsiteLog[],
): Promise<WebsiteInquiryLog[]> {
  const needed = new Map(
    rows
      .filter((r) => !r.logNames && r.changes && needsHistory(r.changes))
      .map((r) => [r.id, r]),
  );
  const captures = new Map<string, Capture>();
  if (needed.size) {
    const history = await manager.query<
      Array<{
        id: string;
        target: string;
        inquiry: string;
        changes: WebsiteLogChange[] | null;
      }>
    >(
      `WITH targets AS (
         SELECT DISTINCT ON (inquiry_id,target_id) inquiry_id,target_id,occurred_at,id
         FROM website_logs WHERE id=ANY($1::uuid[]) ORDER BY inquiry_id,target_id,occurred_at DESC,id DESC
       )
       SELECT l.id,l.target_id AS target,l.inquiry_id AS inquiry,
         CASE WHEN l.id=ANY($1::uuid[]) OR l.changes IS NULL THEN l.changes
           ELSE COALESCE((SELECT jsonb_agg(c ORDER BY n)
             FROM jsonb_array_elements(l.changes) WITH ORDINALITY AS changes(c,n)
             WHERE split_part(split_part(c->>'path','.',1),'[',1) IN
               ('days','deletedDays','reorderDraft','configVersion','owner','ownerId','countryItemId','countryCode','countryOrRegion')), '[]'::jsonb)
         END AS changes
       FROM targets t JOIN website_logs l ON (l.inquiry_id,l.target_id)=(t.inquiry_id,t.target_id)
         AND (l.occurred_at,l.id)<=(t.occurred_at,t.id)
       ORDER BY l.inquiry_id,l.target_id,l.occurred_at,l.id`,
      [[...needed.keys()]],
    );
    let target = '',
      state: Record<string, unknown> = {};
    for (const h of history) {
      const key = h.inquiry + '/' + h.target;
      if (target !== key || h.changes === null) {
        state = {};
        target = key;
      }
      if (h.changes === null) continue;
      const row = needed.get(h.id);
      const captured = replayLog(state, h.changes, !!row);
      if (row && captured)
        captures.set(h.id, {
          captured,
          unit: row.businessUnit,
          inquiry: row.targetType === 'inquiry',
          occurredAt: row.occurredAt,
        });
    }
    await fillCatalog(manager, [...captures.values()], false);
  }
  return rows.map(({ logNames, ...row }) => ({
    ...row,
    displayChanges:
      row.changes === null
        ? null
        : renderLogNames(
            row.changes,
            logNames ?? captures.get(row.id)?.captured.names ?? blankNames(),
          ),
  }));
}
