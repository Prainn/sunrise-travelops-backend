import type { EntityManager } from 'typeorm';

/** Allocate business numbers atomically in PostgreSQL; IDs remain independent. */
export async function nextBusinessCode(
  manager: EntityManager,
  prefix: string,
): Promise<string> {
  const rows: { code: string }[] = await manager.query(
    'SELECT next_business_code($1) AS code',
    [prefix],
  );
  return rows[0].code;
}
