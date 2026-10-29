/** Disposable localhost PostgreSQL only. No business database or environment-file loading. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import {
  IsolationHarness,
  type Actor,
  type Page,
} from './business-isolation.harness';
import { ToursService } from '../src/tours/tours.service';
import type { TourGuideService } from '../src/tours/tour-guide-services';
import { GuidePeopleService } from '../src/resources/guides/guide-people.service';
import { GuidePersonEntity } from '../src/resources/guides/guide-person.entity';
import { ResourceStatus } from '../src/resources/common/resource.constants';
import type {
  CreateTourDto,
  TourGuideServiceInputDto,
} from '../src/tours/tour.dto';
import type { AuthenticatedUser } from '../src/auth/auth.types';
import { effectivePermissions } from '../src/auth/identity-permissions';

const h = new IsolationHarness();
let checks = 0;
async function check(label: string, action: () => Promise<void>) {
  await action();
  checks++;
  console.log(`PASS ${label}`);
}
interface Tour {
  id: string;
  version: number;
  guideServices: TourGuideService[];
  pickupAt: string;
  dropAt: string;
}
interface Rating {
  id: string;
  guideId: string;
  guideServices: TourGuideService[];
  version: number;
  selfScore: number | null;
}
const segment = (
  guideId: string,
  start = '2030-01-09 09:00',
  end = '2030-01-09 12:00',
): TourGuideServiceInputDto => ({
  guideId,
  language: 'English',
  serviceStartAt: start,
  serviceEndAt: end,
  remark: '',
});
const inputs = (tour: Tour): TourGuideServiceInputDto[] =>
  tour.guideServices.map((s) => ({
    id: s.id,
    guideId: s.guideId,
    language: s.language,
    serviceStartAt: s.serviceStartAt,
    serviceEndAt: s.serviceEndAt,
    remark: s.remark,
  }));
async function guide(name: string) {
  const [g] = await h.db.query<{ id: string }[]>(
    `INSERT INTO resource_guide_people(code,name,language) VALUES($1,$2,'English') RETURNING id`,
    [`GPR-${randomUUID()}`, name],
  );
  return g.id;
}
async function upgrade() {
  const database = `guide_upgrade_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  const connection = {
    type: 'postgres' as const,
    host: '127.0.0.1',
    port: Number(process.env.ISOLATION_PG_PORT ?? 55460),
    username: 'postgres',
    password: 'isolation-ci-only',
  };
  const admin = await new DataSource({
    ...connection,
    database: 'postgres',
  }).initialize();
  const db = new DataSource({
    ...connection,
    database,
    entities: ['src/**/*.entity.ts'],
    migrations: ['src/migrations/*.ts'],
    synchronize: false,
  });
  try {
    await admin.query(`CREATE DATABASE "${database}"`);
    await db.initialize();
    const next = db.migrations.find(
      (m) => m.name === 'AddTourGuideServices1794182400000',
    )!;
    assert(next);
    db.migrations.splice(db.migrations.indexOf(next), 1);
    await db.runMigrations();
    const [u] = await db.query<{ id: string }[]>(
      `INSERT INTO users(username,password_hash,nickname,english_name,tour_code) VALUES('upgrade','fixture','Upgrade','Upgrade','UP') RETURNING id`,
    );
    const [g] = await db.query<{ id: string }[]>(
      `INSERT INTO resource_guide_people(code,name,language,status) VALUES('GPR-OLD','Current name','English','disabled') RETURNING id`,
    );
    const [c] = await db.query<{ id: string }[]>(
      `INSERT INTO system_business_dictionary_items(type_id,name,english_name,code) SELECT id,'马来西亚','Malaysia','MYS' FROM system_business_dictionary_types WHERE code='country-region' RETURNING id`,
    );
    async function old(
      no: string,
      start: string,
      end: string,
      assigned = true,
      status = 'active',
    ) {
      const [t] = await db.query<{ id: string }[]>(
        `INSERT INTO tours(tour_no,source_module,business_unit,days,start_date,pickup_at,drop_at,occupy_from,occupy_to,country_item_id,country_code,country_name,creator_id,creator_tour_code,creator_sequence,collect_coordinator_id,collect_coordinator_name,operator_id,operator_name,adults,children,leaders,language,schedule_mode,itinerary_summary,guide_id,guide_name,guide_code,status)
      VALUES($1,'manual','linxi',10,'2026-01-01',$2,$3,'2026-01-01',$3::timestamp::date,$4,'MYS','马来西亚',$5,'UP',1,$5,'Owner',$5,'Owner',1,0,0,'English','manual','历史',$6,$7,$8,$9) RETURNING id`,
        [
          no,
          start,
          end,
          c.id,
          u.id,
          assigned ? g.id : null,
          assigned ? 'Historical name' : null,
          assigned ? 'GPR-HISTORY' : null,
          status,
        ],
      );
      return t.id;
    }
    const normal = await old(
      'OLD-NORMAL',
      '2026-01-01 09:00',
      '2026-01-10 10:00',
    );
    const equal = await old(
      'OLD-EQUAL',
      '2026-01-01 09:00',
      '2026-01-01 09:00',
      true,
      'cancelled',
    );
    const none = await old(
      'OLD-NONE',
      '2026-01-01 09:00',
      '2026-01-10 10:00',
      false,
    );
    await db.query(
      `INSERT INTO tour_ratings(tour_id,guide_id,self_score,version,created_by,updated_by) VALUES($1,$2,0,3,$3,$3)`,
      [normal, g.id, u.id],
    );
    const before = await db.query<Record<string, unknown>[]>(
      'SELECT * FROM tour_ratings ORDER BY tour_id',
    );
    db.migrations.push(next);
    await check(
      'rating mismatch stops migration and rolls back all schema changes',
      async () => {
        await db.query(
          `INSERT INTO tour_ratings(tour_id,guide_id,self_score) VALUES($1,$2,50)`,
          [none, g.id],
        );
        await assert.rejects(db.runMigrations(), /Historical rating guide/);
        const [state] = await db.query<{ table: string | null }[]>(
          `SELECT to_regclass('tour_guide_services')::text AS table`,
        );
        assert.equal(state.table, null);
        await db.query('DELETE FROM tour_ratings WHERE tour_id=$1', [none]);
      },
    );
    await check(
      'old data upgrade, disabled guide snapshots, zero scores, equal legacy and rerun',
      async () => {
        assert.equal((await db.runMigrations()).length, 1);
        assert.equal((await db.runMigrations()).length, 0);
        assert.deepEqual(
          await db.query('SELECT * FROM tour_ratings ORDER BY tour_id'),
          before,
        );
        const services = await db.query<
          {
            id: string;
            guide_name: string;
            time_source: string;
            created_by: null;
          }[]
        >(
          'SELECT id,guide_name,time_source,created_by FROM tour_guide_services ORDER BY id',
        );
        assert.equal(services.length, 2);
        for (const s of services) {
          assert.equal(s.guide_name, 'Historical name');
          assert.equal(s.time_source, 'legacy');
          assert.equal(s.created_by, null);
        }
        assert(services.some((s) => s.id === equal));
        const oldColumns = await db.query<{ column_name: string }[]>(
          `SELECT column_name FROM information_schema.columns WHERE table_name='tours' AND column_name IN ('guide_id','guide_name','guide_code')`,
        );
        assert.equal(oldColumns.length, 0);
        await assert.rejects(
          db.query(
            `UPDATE tour_guide_services SET time_source='manual' WHERE id=$1`,
            [equal],
          ),
        );
      },
    );
    const service = new ToursService(db);
    const actor: AuthenticatedUser = {
      id: u.id,
      identityId: randomUUID(),
      username: 'upgrade',
      nickname: 'Upgrade',
      scope: 'headquarters',
      scopeName: '总部',
      deptId: null,
      deptName: '',
      roles: ['ROOT'],
      permissions: effectivePermissions('headquarters', ['ROOT']),
      menuKeys: [],
    };
    await check(
      'legacy confirmation preserves disabled snapshot and records manual provenance independently',
      async () => {
        const legacy = await service.get(normal, actor);
        const segments = legacy.guideServices as TourGuideService[];
        await service.update(
          normal,
          {
            operatorId: u.id,
            adults: 1,
            children: 0,
            leaders: 0,
            language: 'English',
            shopping: false,
            remark: '',
            scheduleMode: 'manual',
            pickupAt: '2026-01-01 09:00',
            dropAt: '2026-01-10 10:00',
            version: 1,
            guideServices: [
              {
                ...inputs({ guideServices: segments } as Tour)[0],
                confirmTime: true,
              },
            ],
          },
          actor,
        );
        const saved = await service.get(normal, actor);
        const result = (saved.guideServices as TourGuideService[])[0];
        assert.equal(result.timeSource, 'manual');
        assert.equal(result.id, normal);
        assert.equal(result.guideName, 'Historical name');
        assert.equal(result.updatedBy, u.id);
        assert.equal(result.createdBy, null);
      },
    );
    const legacy = await service.get(normal, actor);
    assert.equal(
      (legacy.guideServices as TourGuideService[])[0].guideName,
      'Historical name',
    );
  } finally {
    if (db.isInitialized) await db.destroy();
    await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    await admin.destroy();
  }
}
async function main() {
  await upgrade();
  try {
    await h.start();
    await check(
      'empty full migration chain and repeated execution',
      async () => {
        assert.equal((await h.db.runMigrations()).length, 0);
      },
    );
    const linxi = await h.actor('linxi', 'BUSINESS_MANAGER');
    const website = await h.actor('website', 'BUSINESS_MANAGER');
    const manager = linxi;
    await h.db.query<Record<string, unknown>[]>(
      `INSERT INTO identity_roles(identity_id,role_id) SELECT x.id,r.id FROM user_identities x CROSS JOIN roles r WHERE x.id=ANY($1::uuid[]) AND r.code='COORDINATOR'`,
      [[linxi.identityId, website.identityId]],
    );
    const [country] = await h.db.query<{ id: string }[]>(
      `INSERT INTO system_business_dictionary_items(type_id,name,english_name,code) SELECT id,'马来西亚','Malaysia','MYS' FROM system_business_dictionary_types WHERE code='country-region' RETURNING id`,
    );
    const g1 = await guide('Shared');
    const g2 = await guide('Second');
    function body(
      actor: Actor,
      services: TourGuideServiceInputDto[],
    ): CreateTourDto {
      return {
        sourceModule: 'manual',
        manualSource: {
          businessUnit: actor.scope as 'linxi' | 'website',
          countryItemId: country.id,
          collectCoordinatorId: actor.id,
          contactName: '',
          itinerarySummary: 'Guide service test',
          startDate: '2030-01-01',
          days: 10,
        },
        scheduleMode: 'manual',
        pickupAt: '2030-01-01 09:00',
        dropAt: '2030-01-10 01:35',
        operatorId: actor.id,
        adults: 10,
        children: 0,
        leaders: 0,
        language: 'English',
        shopping: false,
        guideServices: services,
        remark: '',
      };
    }
    const create = (
      actor: Actor,
      services: TourGuideServiceInputDto[],
      status = 201,
    ) =>
      h.call<Tour>(
        actor,
        'POST',
        '/tours',
        body(actor, services),
        status,
        status === 201 ? 'SUCCESS' : 'CONFLICT',
      );
    function update(t: Tour, services = inputs(t)) {
      const b = body(linxi, services);
      return { ...b, sourceModule: undefined, version: t.version };
    }
    let a = await create(linxi, [segment(g1), segment(g2)]);
    await check(
      'same tour multi-guide overlap, stable segment IDs, derived warning and no duplicate tour counts',
      async () => {
        assert.equal(a.guideServices.length, 2);
        assert(
          a.guideServices.every(
            (s) => s.timeSource === 'manual' && !s.outsideTourWindow,
          ),
        );
        const page = await h.call<Page<Tour>>(
          linxi,
          'GET',
          `/tours?guideId=${g1}`,
        );
        assert.equal(page.total, 1);
        a = await h.call<Tour>(linxi, 'PUT', `/tours/${a.id}`, update(a));
        assert.equal(a.guideServices.length, 2);
      },
    );
    await check(
      'same-minute cross-business rejection, one minute later allowed; guests can remain on tour',
      async () => {
        await create(
          website,
          [segment(g1, '2030-01-09 12:00', '2030-01-09 13:00')],
          409,
        );
        const next = await create(website, [
          segment(g1, '2030-01-09 12:01', '2030-01-09 13:00'),
        ]);
        assert(next.id);
        const early = await create(website, [
          segment(g1, '2030-01-10 00:00', '2030-01-10 03:00'),
        ]);
        assert(early.id);
        await h.call(
          website,
          'GET',
          `/tours/${a.id}`,
          undefined,
          404,
          'NOT_FOUND',
        );
      },
    );
    await check(
      'request sibling overlap and invalid / zero duration reject atomically',
      async () => {
        await create(
          linxi,
          [
            segment(g2, '2031-01-01 09:00', '2031-01-01 10:00'),
            segment(g2, '2031-01-01 10:00', '2031-01-01 11:00'),
          ],
          409,
        );
        for (const s of [
          segment(g2, '2031-02-29 09:00', '2031-03-01 10:00'),
          segment(g2, '2031-01-01 10:00', '2031-01-01 10:00'),
        ])
          await h.call(
            linxi,
            'POST',
            '/tours',
            body(linxi, [s]),
            400,
            'VALIDATION_ERROR',
          );
      },
    );
    await check(
      'availability POST includes unsaved siblings and hides cross-business details',
      async () => {
        const query = {
          businessUnit: 'linxi',
          language: 'English',
          serviceStartAt: '2030-01-09 11:00',
          serviceEndAt: '2030-01-09 11:59',
          excludeTourId: a.id,
          otherServices: [
            {
              guideId: g1,
              serviceStartAt: '2030-01-09 09:00',
              serviceEndAt: '2030-01-09 12:00',
            },
          ],
        };
        const list = await h.call<{ id: string }[]>(
          linxi,
          'POST',
          '/tours/available-guides',
          query,
        );
        assert(!list.some((g) => g.id === g1));
        assert(list.some((g) => g.id === g2));
        await h.call(
          website,
          'POST',
          '/tours/available-guides',
          { ...query, businessUnit: 'website' },
          404,
          'NOT_FOUND',
        );
      },
    );
    await check(
      'scoring per tour and guide, zero protects last segment, splitting keeps one rating',
      async () => {
        const r = await h.call<Rating>(
          linxi,
          'PUT',
          `/tours/${a.id}/ratings/${g1}`,
          { version: 0, selfScore: 0 },
        );
        assert.equal(r.selfScore, 0);
        assert.equal(r.version, 1);
        await h.call(
          linxi,
          'PUT',
          `/tours/${a.id}`,
          update(
            a,
            inputs(a).filter((s) => s.guideId !== g1),
          ),
          409,
          'CONFLICT',
        );
        const ss = inputs(a);
        ss.find((s) => s.guideId === g1)!.serviceEndAt = '2030-01-09 10:00';
        ss.push(segment(g1, '2030-01-09 11:00', '2030-01-09 12:00'));
        a = await h.call<Tour>(linxi, 'PUT', `/tours/${a.id}`, update(a, ss));
        const ratings = await h.call<Page<Rating>>(
          linxi,
          'GET',
          '/tours/ratings',
        );
        assert.equal(ratings.total, 2);
        assert.equal(
          ratings.list.find((r) => r.guideId === g1)!.guideServices.length,
          2,
        );
        await h.call(linxi, 'PUT', `/tours/${a.id}/ratings/${g2}`, {
          version: 0,
          managerScore: 80,
        });
        await h.call(
          linxi,
          'PUT',
          `/tours/${a.id}/ratings/${g1}`,
          { version: 0, selfScore: 50 },
          409,
          'CONFLICT',
        );
        await h.call(linxi, 'PUT', `/tours/${a.id}/ratings/${g1}`, {
          version: 1,
          selfScore: null,
        });
        a = await h.call<Tour>(
          linxi,
          'PUT',
          `/tours/${a.id}`,
          update(
            a,
            inputs(a).filter((s) => s.guideId !== g1),
          ),
        );
        assert.equal(
          (
            await h.db.query<Record<string, unknown>[]>(
              'SELECT 1 FROM tour_ratings WHERE tour_id=$1 AND guide_id=$2',
              [a.id, g1],
            )
          ).length,
          0,
        );
      },
    );
    await check(
      'foreign and duplicate segment IDs, parent version and tour date independence',
      async () => {
        const before = await h.db.query<Record<string, unknown>[]>(
          'SELECT * FROM tour_guide_services WHERE tour_id=$1',
          [a.id],
        );
        await h.call(
          linxi,
          'PUT',
          `/tours/${a.id}`,
          update(a, [{ ...segment(g2), id: randomUUID() }]),
          400,
          'VALIDATION_ERROR',
        );
        await h.call(
          linxi,
          'PUT',
          `/tours/${a.id}`,
          update(a, [...inputs(a), ...inputs(a)]),
          400,
          'VALIDATION_ERROR',
        );
        await h.call(
          linxi,
          'PUT',
          `/tours/${a.id}`,
          { ...update(a), version: a.version - 1 },
          409,
          'CONFLICT',
        );
        assert.deepEqual(
          await h.db.query<Record<string, unknown>[]>(
            'SELECT * FROM tour_guide_services WHERE tour_id=$1',
            [a.id],
          ),
          before,
        );
        a = await h.call<Tour>(linxi, 'PUT', `/tours/${a.id}`, {
          ...update(a),
          dropAt: '2030-01-08 23:59',
        });
        assert(a.guideServices[0].outsideTourWindow);
        assert.equal(a.guideServices[0].serviceEndAt, '2030-01-09 12:00');
      },
    );
    await check(
      'whole-day leave follows service not guest dates, including midnight boundary',
      async () => {
        const leave = {
          guidePersonId: g2,
          startDate: '2030-01-09',
          endDate: '2030-01-09',
          reason: '',
          remark: '',
        };
        await h.call(
          manager,
          'POST',
          '/resources/guide-leaves',
          leave,
          409,
          'CONFLICT',
        );
        await h.call(
          manager,
          'POST',
          '/resources/guide-leaves',
          { ...leave, startDate: '2030-01-10', endDate: '2030-01-10' },
          201,
        );
        await create(
          linxi,
          [segment(g2, '2030-01-09 23:00', '2030-01-10 00:00')],
          409,
        );
      },
    );
    await check(
      'simultaneous cross-business allocations serialize and only one succeeds',
      async () => {
        const outcomes = await Promise.allSettled([
          create(linxi, [segment(g1, '2032-01-01 09:00', '2032-01-01 10:00')]),
          create(website, [
            segment(g1, '2032-01-01 09:00', '2032-01-01 10:00'),
          ]),
        ]);
        assert.equal(
          outcomes.filter((o) => o.status === 'fulfilled').length,
          1,
        );
        assert.equal(
          (
            await h.db.query<Record<string, unknown>[]>(
              `SELECT 1 FROM tour_guide_services WHERE guide_id=$1 AND service_start_at='2032-01-01 09:00'`,
              [g1],
            )
          ).length,
          1,
        );
      },
    );
    await check(
      'cancel retains segments and scores, releases occupancy, blocks edits',
      async () => {
        await h.call(
          linxi,
          'POST',
          `/tours/${a.id}/cancel`,
          { version: a.version, reason: 'fixture' },
          201,
        );
        const cancelled = await h.call<Tour>(linxi, 'GET', `/tours/${a.id}`);
        assert.equal(cancelled.guideServices.length, 1);
        await h.call(
          linxi,
          'PUT',
          `/tours/${a.id}/ratings/${g2}`,
          { version: 1, selfScore: 1 },
          409,
          'CONFLICT',
        );
        const fresh = await create(website, [segment(g2)]);
        assert(fresh.id);
      },
    );
    await check(
      'guide disable is based on actual service end and unchanged history remains readable',
      async () => {
        const pastGuide = await guide('Completed');
        let past = await create(linxi, [
          segment(pastGuide, '2020-01-01 09:00', '2020-01-01 10:00'),
        ]);
        const people = new GuidePeopleService(
          h.db.getRepository(GuidePersonEntity),
          h.db,
        );
        const person = await people.get(pastGuide);
        await people.update(
          pastGuide,
          {
            name: person.name,
            status: ResourceStatus.Disabled,
            version: person.version,
          },
          linxi.id,
        );
        past = await h.call<Tour>(
          linxi,
          'PUT',
          `/tours/${past.id}`,
          update(past),
        );
        assert.equal(past.guideServices[0].guideName, 'Completed');
        await h.call(
          linxi,
          'PUT',
          `/tours/${past.id}`,
          update(past, [
            { ...inputs(past)[0], serviceEndAt: '2020-01-01 11:00' },
          ]),
          400,
          'VALIDATION_ERROR',
        );
        const active = await people.get(g1);
        await assert.rejects(
          people.update(
            g1,
            {
              name: active.name,
              status: ResourceStatus.Disabled,
              version: active.version,
            },
            linxi.id,
          ),
        );
      },
    );
    await check(
      'map totals deduplicate segments and today membership follows service times',
      async () => {
        const service = new ToursService(h.db);
        const actor: AuthenticatedUser = {
          ...linxi,
          username: 'fixture',
          nickname: 'fixture',
          scopeName: '霖熹',
          deptId: null,
          deptName: '',
          roles: ['COORDINATOR'],
          permissions: effectivePermissions('linxi', ['COORDINATOR']),
          menuKeys: [],
        };
        const map = await service.map({ date: '2030-01-09' }, actor);
        assert.equal(map.totals.tours, map.tours.length);
        assert.equal(
          map.totals.people,
          map.tours.reduce((n, t) => n + t.totalPeople, 0),
        );
        for (const t of map.tours)
          assert(
            t.todayGuideServices.every(
              (s) =>
                s.serviceStartAt.slice(0, 10) <= '2030-01-09' &&
                s.serviceEndAt.slice(0, 10) >= '2030-01-09',
            ),
          );
      },
    );
    console.log(
      JSON.stringify({ checks, requests: h.requests, result: 'passed' }),
    );
  } finally {
    await h.close();
  }
}
void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
