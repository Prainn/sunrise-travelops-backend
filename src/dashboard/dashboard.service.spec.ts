/* eslint-disable @typescript-eslint/unbound-method -- Jest assertions inspect spies without invoking the methods. */
import type { Request } from 'express';
import type { DataSource } from 'typeorm';
import type { AuthenticatedUser } from '../auth/auth.types';
import { InquiriesService } from '../inquiries/inquiries.service';
import { ItineraryValidation } from '../inquiries/itinerary-validation';
import { AgenciesService } from '../resources/agencies/agencies.service';
import { GuideLeavesService } from '../tours/guide-leaves.service';
import { ToursService } from '../tours/tours.service';
import { WebsiteService } from '../website/website.service';
import { DashboardService } from './dashboard.service';

const permissions = [
  'inquiry:list',
  'website:inquiry:list',
  'tour:list',
  'resource:guide:list',
];
const request = { ip: '127.0.0.1', id: 'dashboard-test' } as unknown as Request;
const user: AuthenticatedUser = {
  id: 'actor-1',
  username: 'test',
  nickname: 'Test',
  identityId: 'identity-1',
  scope: 'headquarters',
  scopeName: '',
  deptId: null,
  deptName: '',
  roles: ['EXECUTIVE'],
  permissions,
  menuKeys: [],
};

describe('Dashboard permission composition and calendar', () => {
  const db = {} as DataSource;
  const inquiries = new InquiriesService(
    db,
    {} as ItineraryValidation,
    {} as AgenciesService,
  );
  const website = new WebsiteService(db);
  const tours = new ToursService(db);
  const leaves = new GuideLeavesService(db);
  const service = new DashboardService(inquiries, website, tours, leaves);

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-18T16:00:00Z'));
    jest.spyOn(inquiries, 'actor');
    jest
      .spyOn(inquiries, 'countByStatus')
      .mockResolvedValue([{ status: 'quoted', count: '3' }]);
    jest.spyOn(website, 'countByStatus').mockResolvedValue([]);
    jest
      .spyOn(tours, 'countActive')
      .mockResolvedValue({ active: 9, departingThisWeek: 2 });
    jest.spyOn(leaves, 'countOnDate').mockResolvedValue(0);
    jest.spyOn(inquiries, 'countCreatedByDate').mockResolvedValue([
      { date: '2026-10-19', count: '2' },
      { date: '2026-10-13', count: '1' },
    ]);
    jest
      .spyOn(website, 'countCreatedByDate')
      .mockResolvedValue([{ date: '2026-10-19', count: '5' }]);
    jest
      .spyOn(tours, 'countDeparturesByDate')
      .mockResolvedValue([{ date: '2026-10-18', count: '4' }]);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it.each(Array.from({ length: 16 }, (_, mask) => mask))(
    'returns null only for inaccessible sources (permission mask %i)',
    async (mask) => {
      const current = {
        ...user,
        permissions: permissions.filter((_, index) => mask & (1 << index)),
      };
      const result = await service.summary(current, request);
      expect(result.inquiries).toEqual(
        mask & 1 ? { new: 0, planning: 0, quoted: 3 } : null,
      );
      expect(result.websiteInquiries).toEqual(
        mask & 2 ? { new: 0, planning: 0, quoted: 0 } : null,
      );
      expect(result.tours).toEqual(
        mask & 4 ? { active: 9, departingThisWeek: 2 } : null,
      );
      expect(result.guideLeavesToday).toBe(mask & 8 ? 0 : null);
      expect(inquiries.actor).toHaveBeenCalledTimes(mask & 1 ? 1 : 0);
      expect(inquiries.countByStatus).toHaveBeenCalledTimes(mask & 1 ? 1 : 0);
      expect(website.countByStatus).toHaveBeenCalledTimes(mask & 2 ? 1 : 0);
      expect(tours.countActive).toHaveBeenCalledTimes(mask & 4 ? 1 : 0);
      expect(leaves.countOnDate).toHaveBeenCalledTimes(mask & 8 ? 1 : 0);
    },
  );

  it.each<{ allowed: string[] }>([
    { allowed: [] },
    { allowed: ['inquiry:list'] },
    { allowed: ['website:inquiry:list'] },
    { allowed: ['inquiry:list', 'website:inquiry:list'] },
  ])(
    'combines only permitted inquiry sources: $allowed',
    async ({ allowed }) => {
      const result = await service.trend(
        7,
        { ...user, permissions: allowed },
        request,
      );
      expect(result.dates).toEqual([
        '2026-10-13',
        '2026-10-14',
        '2026-10-15',
        '2026-10-16',
        '2026-10-17',
        '2026-10-18',
        '2026-10-19',
      ]);
      const standard = allowed.includes('inquiry:list');
      const web = allowed.includes('website:inquiry:list');
      expect(result.newInquiries).toEqual(
        standard || web
          ? [
              standard ? 1 : 0,
              0,
              0,
              0,
              0,
              0,
              (standard ? 2 : 0) + (web ? 5 : 0),
            ]
          : null,
      );
      expect(result.departingTours).toBeNull();
      expect(inquiries.countCreatedByDate).toHaveBeenCalledTimes(
        standard ? 1 : 0,
      );
      expect(website.countCreatedByDate).toHaveBeenCalledTimes(web ? 1 : 0);
      expect(tours.countDeparturesByDate).not.toHaveBeenCalled();
    },
  );

  it('does not treat a website permission code as access from shengxu scope', async () => {
    const current = {
      ...user,
      scope: 'shengxu' as const,
      permissions: ['website:inquiry:list'],
    };
    expect(
      (await service.summary(current, request)).websiteInquiries,
    ).toBeNull();
    expect((await service.trend(7, current, request)).newInquiries).toBeNull();
    expect(website.countByStatus).not.toHaveBeenCalled();
    expect(website.countCreatedByDate).not.toHaveBeenCalled();
  });

  it('aligns the combined inquiry and departure series with the same dates', async () => {
    const result = await service.trend(7, user, request);
    expect(result.newInquiries).toEqual([1, 0, 0, 0, 0, 0, 7]);
    expect(result.departingTours).toEqual([0, 0, 0, 0, 0, 4, 0]);
  });

  it.each([
    ['2026-10-18T15:59:59Z', '2026-10-18', '2026-10-12', '2026-10-19'],
    ['2026-10-18T16:00:00Z', '2026-10-19', '2026-10-19', '2026-10-26'],
    ['2026-12-31T16:00:00Z', '2027-01-01', '2026-12-28', '2027-01-04'],
  ])(
    'uses Shanghai today and Monday week at %s',
    async (now, date, from, until) => {
      jest.setSystemTime(new Date(now));
      await service.summary(user, request);
      expect(tours.countActive).toHaveBeenCalledWith(from, until, user);
      expect(leaves.countOnDate).toHaveBeenCalledWith(date);
    },
  );

  it('returns 30 consecutive dates across year end and zero fills empty aggregates', async () => {
    jest.setSystemTime(new Date('2026-12-31T16:00:00Z'));
    jest.mocked(inquiries.countCreatedByDate).mockResolvedValue([]);
    jest.mocked(website.countCreatedByDate).mockResolvedValue([]);
    jest.mocked(tours.countDeparturesByDate).mockResolvedValue([]);
    const result = await service.trend(30, user, request);
    expect(result.dates).toHaveLength(30);
    expect(result.dates[0]).toBe('2026-12-03');
    expect(result.dates[29]).toBe('2027-01-01');
    expect(result.newInquiries).toEqual(Array(30).fill(0));
    expect(result.departingTours).toEqual(Array(30).fill(0));
    expect(tours.countDeparturesByDate).toHaveBeenCalledWith(
      '2026-12-03',
      '2027-01-02',
      user,
    );
  });

  it('propagates source failures instead of turning errors into zero or null', async () => {
    jest.mocked(tours.countActive).mockRejectedValue(new Error('query failed'));
    await expect(service.summary(user, request)).rejects.toThrow(
      'query failed',
    );
  });
});
