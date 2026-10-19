import type { Request } from 'express';
import { DataSource } from 'typeorm';
import type { AuthenticatedUser } from '../auth/auth.types';
import { effectivePermissions } from '../auth/identity-permissions';
import { InquiryEntity } from '../inquiries/inquiry.entity';
import { InquiryQuery } from '../inquiries/inquiry.dto';
import { InquiriesService } from '../inquiries/inquiries.service';
import { ItineraryValidation } from '../inquiries/itinerary-validation';
import { AgenciesService } from '../resources/agencies/agencies.service';
import { GuideLeavesService } from '../tours/guide-leaves.service';
import { ToursService } from '../tours/tours.service';
import { LeaveQueryDto, TourQueryDto } from '../tours/tour.dto';
import { WebsiteInquiryQuery } from '../website/website.dto';
import { WebsiteService } from '../website/website.service';

// Metadata and real PostgreSQL query builders only; never initialize or connect.
class OfflineDataSource extends DataSource {
  async prepare() {
    await this.buildMetadatas();
  }
}
type Query = { sql: string; params: unknown[] };
const statements: Query[] = [];
const identities: [AuthenticatedUser['scope'], string][] = [
  ['headquarters', 'ROOT'],
  ['headquarters', 'ADMIN'],
  ['headquarters', 'EXECUTIVE'],
  ...(['shengxu', 'linxi', 'website'] as const).flatMap(
    (scope): [AuthenticatedUser['scope'], string][] => [
      [scope, 'BUSINESS_MANAGER'],
      [scope, 'COORDINATOR'],
    ],
  ),
];
function user(
  scope: AuthenticatedUser['scope'],
  role: string,
): AuthenticatedUser {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    username: 'test',
    nickname: 'Test',
    identityId: '00000000-0000-4000-8000-000000000002',
    scope,
    scopeName: '',
    deptId: null,
    deptName: '',
    roles: [role],
    permissions: effectivePermissions(scope, [role]),
    menuKeys: [],
  };
}
function where(query: Query) {
  return query.sql
    .slice(query.sql.lastIndexOf('WHERE'))
    .split(/GROUP BY|ORDER BY|LIMIT/)[0]
    .replaceAll('"', '');
}

describe('Dashboard aggregates share actual list scope SQL', () => {
  const db = new OfflineDataSource({
    type: 'postgres',
    entities: [InquiryEntity],
  });
  const inquiries = new InquiriesService(
    db,
    {} as ItineraryValidation,
    {} as AgenciesService,
  );
  const website = new WebsiteService(db);
  const tours = new ToursService(db);
  const leaves = new GuideLeavesService(db);

  beforeAll(async () => {
    await db.prepare();
    const create = db.manager.createQueryBuilder.bind(db.manager);
    jest
      .spyOn(db.manager, 'createQueryBuilder')
      .mockImplementation((...args: Parameters<typeof create>) => {
        const qb = create(...args);
        const capture = () => {
          const [sql, params] = qb.getQueryAndParameters();
          statements.push({ sql, params });
        };
        jest.spyOn(qb, 'getRawMany').mockImplementation(() => {
          capture();
          return Promise.resolve([]);
        });
        jest.spyOn(qb, 'getManyAndCount').mockImplementation(() => {
          capture();
          return Promise.resolve([[], 0]);
        });
        return qb;
      });
    jest
      .spyOn(db, 'query')
      .mockImplementation((sql: string, params?: unknown[]) => {
        statements.push({ sql, params: params ?? [] });
        return Promise.resolve([
          { count: '0', total: '0', active: '0', departingThisWeek: '0' },
        ]);
      });
  });
  beforeEach(() => {
    statements.length = 0;
  });
  afterAll(() => jest.restoreAllMocks());

  it.each(identities)(
    'ordinary inquiry list/status/trend use the same actor: %s/%s',
    async (scope, role) => {
      const current = user(scope, role);
      const actor = await inquiries.actor(current, {} as Request);
      await inquiries.list(new InquiryQuery(), actor);
      await inquiries.countByStatus(actor);
      await inquiries.countCreatedByDate('2026-10-13', '2026-10-20', actor);
      const queries = statements.filter(({ sql }) =>
        sql.includes('FROM "inquiries"'),
      );
      expect(queries).toHaveLength(3);
      for (const query of queries) {
        expect(where(query).includes('i.business_unit =')).toBe(
          scope !== 'headquarters',
        );
        expect(where(query).includes('i.owner_id =')).toBe(
          scope !== 'headquarters' && role === 'COORDINATOR',
        );
        if (scope !== 'headquarters') expect(query.params).toContain(scope);
        if (role === 'COORDINATOR') expect(query.params).toContain(current.id);
      }
      const trend = queries[2];
      expect(trend.sql).toContain(`AT TIME ZONE 'Asia/Shanghai'`);
      expect(trend.sql).toContain('GROUP BY');
      expect(trend.params).toEqual(
        expect.arrayContaining([
          '2026-10-13T00:00:00+08:00',
          '2026-10-20T00:00:00+08:00',
        ]),
      );
      expect(where(trend)).not.toContain('status');
      expect(queries[1].sql).toContain('COUNT(*)');
      expect(queries[1].sql).not.toMatch(/LIMIT|OFFSET/);
    },
  );

  it.each(identities.filter(([scope]) => scope !== 'shengxu'))(
    'website list/status/trend keep business and owner: %s/%s',
    async (scope, role) => {
      const current = user(scope, role);
      await website.list(new WebsiteInquiryQuery(), current);
      await website.countByStatus(current);
      await website.countCreatedByDate('2026-10-13', '2026-10-20', current);
      expect(statements).toHaveLength(4);
      for (const query of statements) {
        expect(where(query).includes('i.business_unit=')).toBe(
          scope !== 'headquarters',
        );
        expect(where(query).includes('i.owner_id=')).toBe(
          scope !== 'headquarters' && role === 'COORDINATOR',
        );
        if (scope !== 'headquarters') expect(query.params).toContain(scope);
        if (role === 'COORDINATOR') expect(query.params).toContain(current.id);
      }
      expect(where(statements[3])).not.toContain('status');
      expect(statements[3].sql).toContain(`AT TIME ZONE 'Asia/Shanghai'`);
      expect(statements[3].params).toEqual(
        expect.arrayContaining([
          '2026-10-13T00:00:00+08:00',
          '2026-10-20T00:00:00+08:00',
        ]),
      );
    },
  );

  it.each(identities)(
    'tour list/summary/trend preserve participant visibility: %s/%s',
    async (scope, role) => {
      const current = user(scope, role);
      await tours.list(new TourQueryDto(), current);
      await tours.countActive('2026-10-19', '2026-10-26', current);
      await tours.countDeparturesByDate('2026-10-13', '2026-10-20', current);
      expect(statements).toHaveLength(4);
      for (const query of statements) {
        expect(where(query).includes('t.business_unit =')).toBe(
          scope !== 'headquarters',
        );
        for (const column of [
          'collect_coordinator_id',
          'operator_id',
          'creator_id',
        ])
          expect(where(query).includes(`t.${column} =`)).toBe(
            scope !== 'headquarters' && role === 'COORDINATOR',
          );
        if (scope !== 'headquarters') expect(query.params).toContain(scope);
        if (role === 'COORDINATOR') expect(query.params).toContain(current.id);
      }
      expect(statements[2].sql).toContain("t.status='active'");
      expect(statements[2].sql).toContain('COUNT(*) FILTER');
      expect(statements[2].params).toEqual(
        expect.arrayContaining(['2026-10-19', '2026-10-26']),
      );
      expect(statements[3].sql).toContain('GROUP BY t.start_date');
      expect(statements[3].sql).not.toMatch(/LIMIT|OFFSET/);
    },
  );

  it('guide leave count uses the public list visibility and inclusive dates', async () => {
    await leaves.list(new LeaveQueryDto());
    await leaves.countOnDate('2026-10-19');
    expect(statements).toHaveLength(3);
    for (const query of statements) {
      expect(where(query)).toContain(
        'l.deleted_at IS NULL AND g.deleted_at IS NULL',
      );
      expect(where(query)).not.toMatch(/business_unit|g.status/);
    }
    expect(statements[2].sql).toContain(
      'l.start_date <= $1 AND l.end_date >= $1',
    );
    expect(statements[2].params).toEqual(['2026-10-19']);
  });

  it('source aggregates retain their permission checks if called directly', async () => {
    const denied = { ...user('headquarters', 'ROOT'), permissions: [] };
    const actor = await inquiries.actor(denied, {} as Request);
    await expect(inquiries.countByStatus(actor)).rejects.toMatchObject({
      status: 403,
    });
    await expect(website.countByStatus(denied)).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      tours.countActive('2026-10-19', '2026-10-26', denied),
    ).rejects.toMatchObject({ status: 403 });
    expect(statements).toHaveLength(0);
  });
});
