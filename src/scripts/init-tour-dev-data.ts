/** Idempotent, explicitly authorised dev data initialisation; no account creation. */
import { EntityManager } from 'typeorm';
import {
  AIRPORT_CATALOG,
  countryCatalog,
} from '../system/business-dictionaries/dictionary-catalogs';

export const COUNTRIES = [
  'MYS',
  'TWN',
  'KHM',
  'SGP',
  'BRN',
  'IDN',
  'PHL',
  'ESP',
  'CHN',
  'HKG',
  'DEU',
  'NZL',
  'KGZ',
  'AUS',
  'CAN',
];
// Verified-unambiguous city labels only; multi-airport cities stay pending.
const CITY_AIRPORT: Record<string, string> = {
  昆明: 'KMG',
  广州: 'CAN',
  深圳: 'SZX',
  香港: 'HKG',
  丽江: 'LJG',
  厦门: 'XMN',
  杭州: 'HGH',
  武汉: 'WUH',
  福州: 'FOC',
  重庆: 'CKG',
  香格里拉: 'DIG',
  仰光: 'RGN',
  曼德勒: 'MDL',
  新加坡: 'SIN',
  文莱: 'BWN',
  槟城: 'PEN',
  新山: 'JHB',
  新山士乃机场: 'JHB',
  吉隆坡梳邦: 'SZB',
};
export const TOUR_CODES: [string, string, string][] = [
  ['shengxu', 'caolanyi', 'CLY'],
  ['shengxu', 'guoxiao', 'GX'],
  ['shengxu', 'houyue', 'HY'],
  ['shengxu', 'juan', 'YJ'],
  ['shengxu', 'ligang', 'LG'],
  ['shengxu', 'lijiaojiao', 'LJJ'],
  ['shengxu', 'mayuanyuan', 'MYY'],
  ['shengxu', 'sunqian', 'SQ'],
  ['shengxu', 'taojinlian', 'TJL'],
  ['website', 'houyue', 'HY'],
  ['website', 'luolulu', 'LLL'],
  ['website', 'liboss', 'LB'],
  ['website', 'zhoujunyu', 'ZJY'],
  ['headquarters', 'sunrise', 'SR'],
];

type Item = {
  id: string;
  code: string;
  name: string;
  englishName: string;
  status: string;
  deletedAt: string | null;
};
type Flight = {
  id: string;
  library: string;
  flightNumber: string;
  departureCity: string;
  arrivalCity: string;
  departureTime: string;
  arrivalTime: string;
  departureAirportId: string | null;
  arrivalAirportId: string | null;
};
const flightSelect = `id, library, flight_number AS "flightNumber", departure_city AS "departureCity", arrival_city AS "arrivalCity", departure_time AS "departureTime", arrival_time AS "arrivalTime", departure_airport_id AS "departureAirportId", arrival_airport_id AS "arrivalAirportId"`;

export async function tourDataPreflight(m: EntityManager) {
  return {
    items: await m.query<(Item & { type: string })[]>(
      `SELECT i.id, t.code AS type, i.code, i.name, i.english_name AS "englishName", i.status, i.deleted_at AS "deletedAt" FROM system_business_dictionary_items i JOIN system_business_dictionary_types t ON t.id=i.type_id WHERE t.code IN ('country-region','city-airport') ORDER BY t.code,i.code`,
    ),
    users: await m.query<
      {
        id: string;
        scope: string;
        username: string;
        englishName: string;
        tourCode: string | null;
      }[]
    >(
      `SELECT u.id,i.scope,i.username,u.english_name AS "englishName",u.tour_code AS "tourCode" FROM users u JOIN user_identities i ON i.user_id=u.id WHERE u.deleted_at IS NULL ORDER BY i.scope,i.username`,
    ),
    flights: await m.query<Flight[]>(
      `SELECT ${flightSelect} FROM resource_flights WHERE deleted_at IS NULL ORDER BY library,flight_number,id`,
    ),
    agencies: await m.query<{ id: string; countryOrRegion: string }[]>(
      `SELECT id,country_or_region AS "countryOrRegion" FROM resource_agencies WHERE country_item_id IS NULL AND deleted_at IS NULL ORDER BY id`,
    ),
  };
}

export async function initTourData(m: EntityManager) {
  const preflight = await tourDataPreflight(m);
  const report: Record<string, unknown> = {};
  const seed = async (
    type: string,
    entries: { code: string; name: string; englishName: string }[],
  ) => {
    const types = await m.query<{ id: string }[]>(
      'SELECT id FROM system_business_dictionary_types WHERE code=$1 AND deleted_at IS NULL',
      [type],
    );
    if (types.length !== 1) throw new Error(`Missing dictionary type ${type}`);
    const added: string[] = [];
    const mismatches: string[] = [];
    for (const e of entries) {
      const current = preflight.items.find(
        (i) => i.type === type && i.code === e.code,
      );
      if (
        current &&
        (current.name !== e.name ||
          current.englishName !== e.englishName ||
          current.status !== 'enabled' ||
          current.deletedAt)
      )
        mismatches.push(e.code);
      const r = await m.query<{ id: string }[]>(
        `INSERT INTO system_business_dictionary_items (type_id,code,name,english_name,resource_types,status,remark) VALUES ($1,$2,$3,$4,'{}','enabled','') ON CONFLICT (type_id,code) DO NOTHING RETURNING id`,
        [types[0].id, e.code, e.name, e.englishName],
      );
      if (r.length) added.push(e.code);
    }
    return { inserted: added.length, added, mismatches };
  };
  const countries = countryCatalog().filter((c) => COUNTRIES.includes(c.code));
  report.countries = await seed('country-region', countries);
  report.airports = await seed('city-airport', AIRPORT_CATALOG);
  const afterItems = (await tourDataPreflight(m)).items;
  const usable = (
    type: string,
    catalog: { code: string; name: string; englishName: string }[],
  ) =>
    afterItems.filter(
      (i) =>
        i.type === type &&
        i.status === 'enabled' &&
        !i.deletedAt &&
        catalog.some(
          (c) =>
            c.code === i.code &&
            c.name === i.name &&
            c.englishName === i.englishName,
        ),
    );
  const airports = new Map(
    usable('city-airport', AIRPORT_CATALOG).map((i) => [i.code, i.id]),
  );
  let flightUpdates = 0;
  for (const f of preflight.flights) {
    const from =
      f.departureAirportId ??
      airports.get(CITY_AIRPORT[f.departureCity] ?? '') ??
      null;
    const to =
      f.arrivalAirportId ??
      airports.get(CITY_AIRPORT[f.arrivalCity] ?? '') ??
      null;
    if (from === f.departureAirportId && to === f.arrivalAirportId) continue;
    await m.query(
      'UPDATE resource_flights SET departure_airport_id=$2,arrival_airport_id=$3,version=version+1,updated_at=now() WHERE id=$1',
      [f.id, from, to],
    );
    flightUpdates++;
  }
  report.flightUpdates = flightUpdates;
  const countryItems = usable('country-region', countryCatalog());
  const normalize = (s: string) => s.trim().toLocaleLowerCase();
  let agencyUpdates = 0;
  for (const a of preflight.agencies) {
    const key = normalize(a.countryOrRegion || '');
    const matches = countryItems.filter(
      (c) =>
        [c.code, c.name, c.englishName].some((v) => normalize(v) === key) ||
        (key === '中国台湾' && c.code === 'TWN'),
    );
    if (matches.length !== 1) continue;
    await m.query(
      'UPDATE resource_agencies SET country_item_id=$2,version=version+1,updated_at=now() WHERE id=$1 AND country_item_id IS NULL',
      [a.id, matches[0].id],
    );
    agencyUpdates++;
  }
  report.agencyUpdates = agencyUpdates;
  const applied: string[] = [];
  const missing: string[] = [];
  for (const [scope, username, code] of TOUR_CODES) {
    const candidates = preflight.users.filter(
      (u) => u.scope === scope && u.username === username,
    );
    if (candidates.length !== 1) {
      missing.push(`${scope}/${username}`);
      continue;
    }
    const account = candidates[0];
    const desired = TOUR_CODES.filter(([s, n]) =>
      preflight.users.some(
        (u) => u.id === account.id && u.scope === s && u.username === n,
      ),
    ).map((v) => v[2]);
    if (new Set(desired).size !== 1)
      throw new Error(`Conflicting defaults for user ${account.id}`);
    const r = await m.query<{ id: string }[]>(
      `WITH updated AS (UPDATE users SET tour_code=$2 WHERE id=$1 AND (tour_code IS NULL OR btrim(tour_code)='') RETURNING id) SELECT id FROM updated`,
      [account.id, code],
    );
    if (r.length) applied.push(`${scope}/${username}:${account.id}`);
  }
  report.tourCodesApplied = applied;
  report.unmatchedDefaults = missing;
  const readback = await tourDataPreflight(m);
  report.readback = {
    items: readback.items,
    users: readback.users,
    flights: {
      total: readback.flights.length,
      complete: readback.flights.filter(
        (f) => f.departureAirportId && f.arrivalAirportId,
      ).length,
      pending: readback.flights.filter(
        (f) => !f.departureAirportId || !f.arrivalAirportId,
      ),
    },
    pendingAgencies: readback.agencies,
    usersWithoutTourCode: readback.users.filter((u) => !u.tourCode?.trim()),
    usersOutsideDefaults: readback.users.filter(
      (u) => !TOUR_CODES.some(([s, n]) => s === u.scope && n === u.username),
    ),
  };
  return report;
}

async function main() {
  const { default: db } = await import('../database/data-source');
  await db.initialize();
  try {
    const [target] = await db.query<{ database: string }[]>(
      'SELECT current_database() AS database',
    );
    if (target.database !== 'travelops_dev')
      throw new Error(`Refusing database ${target.database}`);
    if (await db.showMigrations())
      throw new Error(
        'Pending migrations must be reviewed and applied separately',
      );
    const preflight = await tourDataPreflight(db.manager);
    console.log(
      JSON.stringify(
        { database: target.database, pendingMigrations: [], preflight },
        null,
        2,
      ),
    );
    if (!process.argv.includes('--apply')) return;
    const report = await db.transaction(initTourData);
    console.log(JSON.stringify({ database: target.database, report }, null, 2));
  } finally {
    await db.destroy();
  }
}
if (require.main === module)
  void main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  });
