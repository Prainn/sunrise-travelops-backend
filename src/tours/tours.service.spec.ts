import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DataSource, EntityManager } from 'typeorm';
import { AuthenticatedUser } from '../auth/auth.types';
import { CreateTourDto, UpdateTourDto } from './tour.dto';
import { ToursService } from './tours.service';

const actor = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const user: AuthenticatedUser = {
  id: actor,
  username: 'test',
  nickname: 'Test',
  identityId: actor,
  scope: 'shengxu',
  scopeName: '',
  deptId: null,
  deptName: '',
  roles: ['COORDINATOR'],
  menuKeys: [],
  permissions: [
    'tour:list',
    'tour:create',
    'tour:update',
    'tour:rating:update',
  ],
};
const input = (): CreateTourDto =>
  plainToInstance(CreateTourDto, {
    sourceModule: 'manual',
    scheduleMode: 'manual',
    operatorId: actor,
    adults: 0,
    children: 0,
    leaders: 0,
    shopping: false,
    pickupAt: '2026-10-25 09:00',
    dropAt: '2026-10-28 08:00',
    manualSource: {
      businessUnit: 'shengxu',
      countryItemId: other,
      collectCoordinatorId: actor,
      agencyName: 'Agency',
      itinerarySummary: '昆大丽',
      startDate: '2026-10-25',
      days: 3,
    },
  });

type Row = Record<string, unknown>;
function setup(tour?: Row, rating?: Row) {
  const query = jest.fn(
    async (sql: string, params?: unknown[]): Promise<Row[]> => {
      await Promise.resolve();
      if (sql.includes('FOR UPDATE') && sql.includes('FROM tours'))
        return tour ? [tour] : [];
      if (sql.includes('FROM tour_ratings')) return rating ? [rating] : [];
      if (sql.includes('FROM users u'))
        return [{ id: params?.[0], name: 'Coordinator' }];
      if (sql.includes('FROM system_business_dictionary_items'))
        return [{ code: 'MYS', name: '马来西亚' }];
      if (sql.includes('SELECT tour_code')) return [{ tour_code: 'AS' }];
      if (sql.includes('INSERT INTO tour_number_counters'))
        return [{ last_value: 1 }];
      if (sql.includes('INSERT INTO tours')) return [{ id: other }];
      if (sql.includes('FROM resource_guide_people'))
        return [{ id: other, name: 'Current name', code: 'GPR-001' }];
      if (sql.includes('FROM tours t'))
        return [
          {
            id: other,
            status: 'active',
            businessUnit: 'shengxu',
            guideName: 'Booked name',
          },
        ];
      return [];
    },
  );
  const manager = { query } as unknown as EntityManager;
  const db = {
    query,
    manager,
    transaction: async <T>(work: (m: EntityManager) => Promise<T>) =>
      work(manager),
  } as unknown as DataSource;
  return { service: new ToursService(db), query };
}
const savedTour = (): Row => ({
  id: other,
  source_module: 'manual',
  business_unit: 'shengxu',
  status: 'active',
  version: 1,
  country_item_id: other,
  country_code: 'MYS',
  country_name: '马来西亚',
  creator_id: actor,
  collect_coordinator_id: actor,
  collect_coordinator_name: 'Collector',
  operator_id: actor,
  operator_name: 'Operator',
  start_date: '2026-10-25',
  days: 3,
  pickup_at: '2026-10-25 09:00',
  drop_at: '2026-10-28 08:00',
  pickup_flight_id: null,
  drop_flight_id: null,
  pickup_flight: null,
  drop_flight: null,
  guide_id: other,
  guide_name: 'Booked name',
  guide_code: 'GPR-001',
  itinerary_summary: '昆大丽',
  agency_name: 'Agency',
  contact_name: '',
});
const updateInput = (): UpdateTourDto => {
  const values: Partial<CreateTourDto> = { ...input() };
  delete values.sourceModule;
  return Object.assign(new UpdateTourDto(), values, {
    version: 1,
    guideId: other,
  });
};

describe('manual tour contract and scope', () => {
  it('accepts manual source and zero counts without inquiry or flights', async () => {
    expect(
      await validate(input(), { whitelist: true, forbidNonWhitelisted: true }),
    ).toEqual([]);
    const { service, query } = setup();
    await service.create(input(), user);
    const write = query.mock.calls.find(([sql]) =>
      sql.includes('INSERT INTO tours'),
    )!;
    expect(write[1]?.slice(1, 9)).toEqual([
      'manual',
      'shengxu',
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(write[1]?.slice(32, 36)).toEqual([null, null, null, null]);
    expect(
      query.mock.calls.some(([sql]) =>
        /FROM (inquiries|website_inquiries|itinerary_quotes)/.test(sql),
      ),
    ).toBe(false);
  });
  it.each(['inquiryId', 'quoteId'])(
    'rejects a hidden %s on manual creation',
    async (field) => {
      const { service } = setup();
      await expect(
        service.create({ ...input(), [field]: other }, user),
      ).rejects.toMatchObject({ status: 400 });
    },
  );
  it('rejects another business and another collector for coordinators', async () => {
    const { service } = setup();
    const cross = input();
    cross.manualSource!.businessUnit = 'linxi';
    await expect(service.create(cross, user)).rejects.toMatchObject({
      status: 403,
    });
    const collector = input();
    collector.manualSource!.collectCoordinatorId = other;
    await expect(service.create(collector, user)).rejects.toMatchObject({
      status: 403,
    });
  });
  it('requires linked source IDs and rejects malformed nested manual data', async () => {
    const linked = plainToInstance(CreateTourDto, {
      ...input(),
      sourceModule: 'standard',
      manualSource: undefined,
    });
    expect((await validate(linked)).map((e) => e.property)).toEqual(
      expect.arrayContaining(['inquiryId', 'quoteId']),
    );
    const bad = input();
    bad.manualSource!.days = 0;
    expect((await validate(bad)).map((e) => e.property)).toContain(
      'manualSource',
    );
  });
  it('rejects flight IDs mixed with manual times and manual times on linked sources', async () => {
    const { service } = setup();
    await expect(
      service.create({ ...input(), pickupFlightId: other }, user),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.create(
        {
          ...input(),
          sourceModule: 'standard',
          manualSource: undefined,
          inquiryId: other,
          quoteId: other,
        },
        user,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('keeps source unit and country immutable when editing', async () => {
    const { service } = setup(savedTour());
    const patch = updateInput();
    patch.manualSource!.countryItemId = actor;
    await expect(service.update(other, patch, user)).rejects.toMatchObject({
      status: 400,
    });
  });
  it('recomputes manual occupancy from edited dates', async () => {
    const { service, query } = setup(savedTour());
    const patch = updateInput();
    patch.manualSource!.startDate = '2026-10-26';
    patch.pickupAt = '2026-10-26 09:00';
    await service.update(other, patch, user);
    const write = query.mock.calls.find(([sql]) =>
      sql.startsWith('UPDATE tours'),
    )!;
    expect(write[1]?.slice(12, 16)).toEqual([
      '2026-10-26 09:00',
      '2026-10-28 08:00',
      '2026-10-26',
      '2026-10-28',
    ]);
    expect(
      query.mock.calls.some(
        ([sql]) =>
          sql.includes('FROM resource_guide_people') &&
          sql.includes('FOR UPDATE'),
      ),
    ).toBe(true);
  });
  it('preserves booked guide labels without requiring enabled master data for unchanged allocation', async () => {
    const { service, query } = setup(savedTour());
    await service.update(other, updateInput(), user);
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('FROM resource_guide_people'),
      ),
    ).toBe(false);
    const write = query.mock.calls.find(([sql]) =>
      sql.startsWith('UPDATE tours'),
    )!;
    expect(write[1]?.slice(21, 23)).toEqual(['Booked name', 'GPR-001']);
  });
  it('still forbids clearing a rated guide when its score is zero', async () => {
    const { service } = setup(savedTour(), { self_score: 0 });
    await expect(
      service.update(other, { ...updateInput(), guideId: null }, user),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('gives headquarters ROOT write access and canEdit while rejecting ADMIN', async () => {
    const { service } = setup(savedTour());
    const root = {
      ...user,
      id: 'root',
      scope: 'headquarters' as const,
      roles: ['ROOT'],
    };
    await expect(
      service.saveRating(other, { version: 0, selfScore: 0 }, root),
    ).resolves.toMatchObject({ canEdit: true, guideName: 'Booked name' });
    await expect(
      service.saveRating(
        other,
        { version: 0, selfScore: 0 },
        { ...root, roles: ['ADMIN'] },
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
});
