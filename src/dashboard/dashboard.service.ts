import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/auth.types';
import { InquiriesService } from '../inquiries/inquiries.service';
import { GuideLeavesService } from '../tours/guide-leaves.service';
import { ToursService } from '../tours/tours.service';
import { addDays } from '../tours/tour-rules';
import { WebsiteService } from '../website/website.service';
import {
  DashboardSummary,
  DashboardTrend,
  InquiryStatusCounts,
} from './dashboard.dto';

function today(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function statusCounts(
  rows: { status: string; count: string }[] | null,
): InquiryStatusCounts | null {
  if (rows === null) return null;
  const counts = new Map(rows.map((row) => [row.status, Number(row.count)]));
  return {
    new: counts.get('new') ?? 0,
    planning: counts.get('planning') ?? 0,
    quoted: counts.get('quoted') ?? 0,
  };
}

/** Combines only daily aggregates; business visibility remains in each source service. */
@Injectable()
export class DashboardService {
  constructor(
    private readonly inquiries: InquiriesService,
    private readonly website: WebsiteService,
    private readonly tours: ToursService,
    private readonly leaves: GuideLeavesService,
  ) {}

  async summary(
    user: AuthenticatedUser,
    request: Request,
  ): Promise<DashboardSummary> {
    const date = today();
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const weekFrom = addDays(date, -((weekday + 6) % 7));
    const [inquiries, websiteInquiries, tours, guideLeavesToday] =
      await Promise.all([
        user.permissions.includes('inquiry:list')
          ? this.inquiries.countByStatus(
              await this.inquiries.actor(user, request),
            )
          : null,
        this.website.canListInquiries(user)
          ? this.website.countByStatus(user)
          : null,
        user.permissions.includes('tour:list')
          ? this.tours.countActive(weekFrom, addDays(weekFrom, 7), user)
          : null,
        user.permissions.includes('resource:guide:list')
          ? this.leaves.countOnDate(date)
          : null,
      ]);
    return {
      inquiries: statusCounts(inquiries),
      websiteInquiries: statusCounts(websiteInquiries),
      tours,
      guideLeavesToday,
    };
  }

  async trend(
    days: 7 | 30,
    user: AuthenticatedUser,
    request: Request,
  ): Promise<DashboardTrend> {
    const date = today();
    const from = addDays(date, 1 - days);
    const until = addDays(date, 1);
    const dates = Array.from({ length: days }, (_, index) =>
      addDays(from, index),
    );
    const canReadStandard = user.permissions.includes('inquiry:list');
    const canReadWebsite = this.website.canListInquiries(user);
    const [standard, website, tours] = await Promise.all([
      canReadStandard
        ? this.inquiries.countCreatedByDate(
            from,
            until,
            await this.inquiries.actor(user, request),
          )
        : [],
      canReadWebsite ? this.website.countCreatedByDate(from, until, user) : [],
      user.permissions.includes('tour:list')
        ? this.tours.countDeparturesByDate(from, until, user)
        : null,
    ]);
    const inquiriesByDate = new Map<string, number>();
    for (const row of [...standard, ...website])
      inquiriesByDate.set(
        row.date,
        (inquiriesByDate.get(row.date) ?? 0) + Number(row.count),
      );
    const toursByDate = new Map(
      tours?.map((row) => [row.date, Number(row.count)]),
    );
    return {
      dates,
      newInquiries:
        canReadStandard || canReadWebsite
          ? dates.map((day) => inquiriesByDate.get(day) ?? 0)
          : null,
      departingTours:
        tours === null ? null : dates.map((day) => toursByDate.get(day) ?? 0),
    };
  }
}
