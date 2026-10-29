import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DataSource, EntityManager } from 'typeorm';
import type { AuthenticatedUser } from '../auth/auth.types';
import { buildTourMap, CityLocation, MapPlan, MapTourRow } from './tour-map';
import { TourMapQuery } from './tour-map.dto';
import { ToursService } from './tours.service';
const cities: CityLocation[] = [
  {
    id: 'k',
    name: '昆明',
    province: '云南',
    longitude: 102.7,
    latitude: 25,
    status: 'enabled',
  },
  {
    id: 'd',
    name: '大理',
    province: '云南省',
    longitude: 100.2,
    latitude: 25.6,
    status: 'enabled',
  },
  {
    id: 'g',
    name: '广州',
    province: '广东',
    longitude: 113,
    latitude: 23,
    status: 'enabled',
  },
  {
    id: 'l',
    name: '丽江',
    province: '云南',
    longitude: null,
    latitude: null,
    status: 'enabled',
  },
];
const row: MapTourRow = {
  id: 't',
  tourNo: 'T1',
  businessUnit: 'website',
  sourceModule: 'website',
  totalPeople: 4,
  adults: 2,
  children: 1,
  leaders: 1,
  guideServices: [],
  todayGuideServices: [],
  collectCoordinatorName: 'A',
  operatorName: 'B',
  pickupAt: '2026-10-26 08:00',
  dropAt: '2026-10-27 10:00',
  pickupFlight: null,
  dropFlight: null,
  days: 1,
};
function plan(): MapPlan {
  return {
    tourId: 't',
    startDate: '2026-10-26',
    config: {
      cities: [
        {
          id: 'wk',
          nameZh: '昆明',
          nameEn: '',
          resourceId: null,
          status: 'enabled',
        },
        {
          id: 'wd',
          nameZh: '大理',
          nameEn: '',
          resourceId: 'd',
          status: 'enabled',
        },
      ],
      attractions: [],
    },
    currentConfig: {
      cities: [
        {
          id: 'wk',
          nameZh: '昆明',
          nameEn: '',
          resourceId: 'k',
          status: 'enabled',
        },
      ],
    },
    days: [
      {
        id: 'day',
        dayNumber: 1,
        departCityId: 'wk',
        endCityId: 'wd',
        overnightCityId: 'wd',
        items: [],
        legs: [],
        hotels: [],
        meals: [],
        services: [],
        guideLanguage: '',
      },
    ],
  };
}
test('同团跨城去重、历史明确关联补足、手工团计入待定位及接送', () => {
  const result = buildTourMap(
    '2026-10-26',
    null,
    true,
    [row, { ...row, id: 'm', sourceModule: 'manual' }],
    cities,
    [plan()],
  );
  expect(result.totals).toEqual({
    tours: 2,
    people: 8,
    located: 1,
    unlocated: 1,
  });
  expect(result.cities.find((c) => c.id === 'd')?.tourCount).toBe(1);
  expect(result.cities.find((c) => c.id === 'k')?.peopleCount).toBe(4);
  expect(result.unlocatedTourIds).toEqual(['m']);
  expect(result.pickupTourIds).toEqual(['t', 'm']);
  expect(result.tours[0].today?.stops.map((s) => s.role)).toEqual([
    'departure',
    'arrival',
    'overnight',
  ]);
});
test('不按旧ID的新名称补关联，不跨过未定位点连线，日期超出行程单独提示', () => {
  const p = plan();
  p.currentConfig!.cities[0].nameZh = '另一个地方';
  const result = buildTourMap('2026-10-26', 'website', false, [row], cities, [
    p,
  ]);
  expect(result.tours[0].issues).toEqual(['city_unlinked']);
  expect(result.tours[0].today?.stops[0].cityId).toBeNull();
  expect(result.tours[0].located).toBe(true);
  expect(
    buildTourMap('2026-10-27', 'website', false, [row], cities, [p]).tours[0]
      .issues,
  ).toEqual(['date_not_covered']);
});
test('省外和缺坐标不会成为云南已定位城市', () => {
  const p = plan();
  p.config!.cities[0].resourceId = 'g';
  p.config!.cities[1].resourceId = 'l';
  const result = buildTourMap('2026-10-26', null, true, [row], cities, [p]);
  expect(result.tours[0].issues).toEqual([
    'outside_yunnan',
    'coordinates_missing',
  ]);
  expect(result.totals.located).toBe(0);
});
test('普通来源读取冻结日程，保留明确不住宿且不暴露金额', () => {
  const p = {
    tourId: 't',
    standard: {
      dailyPlans: [
        {
          date: '2026-10-26',
          dayNumber: 1,
          departure: '昆明',
          destination: '大理',
          overnightDestination: '',
          items: [],
          meals: { breakfast: true, lunch: false, dinner: false },
          transport: '汽车',
          description: '计划安排',
        },
      ],
      hotelPlans: [],
    },
  } as unknown as MapPlan;
  const result = buildTourMap(
    '2026-10-26',
    null,
    true,
    [{ ...row, sourceModule: 'standard' }],
    cities,
    [p],
  );
  expect(result.tours[0].today?.stops).toHaveLength(2);
  expect(result.tours[0].today?.description).toBe('计划安排');
  expect(JSON.stringify(result)).not.toContain('unitCost');
});
test('日期必须为真实自然日，禁止时间戳及跨业务枚举', async () => {
  for (const input of [
    { date: '2026-02-30' },
    { date: '2026-10-26T00:00:00Z' },
    { businessUnit: 'headquarters' },
  ])
    expect(
      (await validate(plainToInstance(TourMapQuery, input))).length,
    ).toBeGreaterThan(0);
  expect(
    await validate(plainToInstance(TourMapQuery, { date: '2026-10-26' })),
  ).toEqual([]);
});
test('权限先于查询，人员与业务范围进入SQL，跨业务参数直接拒绝', async () => {
  const query = jest
    .fn<Promise<unknown[]>, [string, unknown[]?]>()
    .mockResolvedValue([]);
  const db = {
    transaction: jest.fn((_level: string, run: (m: EntityManager) => unknown) =>
      run({ query } as unknown as EntityManager),
    ),
  } as unknown as DataSource;
  const service = new ToursService(db);
  const user = {
    id: 'u',
    scope: 'website',
    roles: ['COORDINATOR'],
    permissions: ['tour:list'],
  } as AuthenticatedUser;
  await expect(service.map({}, { ...user, permissions: [] })).rejects.toThrow();
  await expect(service.map({ businessUnit: 'linxi' }, user)).rejects.toThrow();
  expect(query).not.toHaveBeenCalled();
  await service.map({ date: '2026-10-26' }, user);
  expect(query.mock.calls[0][0]).toContain('t.business_unit = $2');
  expect(query.mock.calls[0][0]).toContain('t.operator_id = $3');
  expect(query.mock.calls[0][0]).toContain("t.status='active'");
  expect(query.mock.calls[0][1]).toEqual(['2026-10-26', 'website', 'u']);
});
