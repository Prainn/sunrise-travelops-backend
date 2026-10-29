import { randomUUID } from 'node:crypto';
import { HttpStatus } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { ErrorCode } from '../common/constants/error-code';
import { BusinessException } from '../common/exceptions/business.exception';
import type { TourGuideServiceInputDto } from './tour.dto';
import { validateServiceTimes } from './tour-rules';

export interface TourGuideService {
  id: string;
  tourId: string;
  guideId: string;
  guideName: string;
  guideCode: string;
  language: string;
  serviceStartAt: string;
  serviceEndAt: string;
  remark: string;
  timeSource: 'legacy' | 'manual';
  invalidDuration: boolean;
  outsideTourWindow: boolean;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

/** Correlated aggregate preserves one row per tour, including pagination and map totals. */
export function guideServicesJson(
  tourAlias: string,
  guideExpression?: string,
): string {
  return `COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'id',gs.id,'tourId',gs.tour_id,'guideId',gs.guide_id,'guideName',gs.guide_name,'guideCode',gs.guide_code,
    'language',gs.language,'serviceStartAt',to_char(gs.service_start_at,'YYYY-MM-DD HH24:MI'),
    'serviceEndAt',to_char(gs.service_end_at,'YYYY-MM-DD HH24:MI'),'remark',gs.remark,'timeSource',gs.time_source,
    'invalidDuration',gs.service_start_at>=gs.service_end_at,
    'outsideTourWindow',gs.service_start_at<${tourAlias}.pickup_at OR gs.service_end_at>${tourAlias}.drop_at,
    'createdAt',gs.created_at,'createdBy',gs.created_by,'updatedAt',gs.updated_at,'updatedBy',gs.updated_by
  ) ORDER BY gs.service_start_at,gs.service_end_at,gs.id)
  FROM tour_guide_services gs WHERE gs.tour_id=${tourAlias}.id${guideExpression ? ` AND gs.guide_id=${guideExpression}` : ''}),'[]'::jsonb)`;
}

export interface GuideServiceChange {
  serviceIds: string[];
  guideIds: string[];
  removedServiceIds: string[];
  removedGuideIds: string[];
}
export type GuideServiceChangeHandler = (change: GuideServiceChange) => void;

interface StoredService {
  id: string;
  guide_id: string;
  guide_name: string;
  guide_code: string;
  language: string;
  service_start_at: string;
  service_end_at: string;
  remark: string;
  time_source: 'legacy' | 'manual';
}
interface Guide {
  id: string;
  name: string;
  code: string;
  language: string | null;
  status: string;
  deleted_at: unknown;
}
interface PreparedService {
  input: TourGuideServiceInputDto;
  old?: StoredService;
  id: string;
  guideName: string;
  guideCode: string;
  timeSource: 'legacy' | 'manual';
}

function reject(
  message: string,
  index: number,
  id?: string,
  conflict = false,
): never {
  throw new BusinessException({
    code: conflict ? ErrorCode.CONFLICT : ErrorCode.VALIDATION_ERROR,
    status: conflict ? HttpStatus.CONFLICT : HttpStatus.BAD_REQUEST,
    message,
    details: { serviceIndex: index, serviceId: id ?? null },
  });
}

export async function lockServiceGuides(
  manager: EntityManager,
  ids: string[],
): Promise<Guide[]> {
  if (!ids.length) return [];
  return manager.query<Guide[]>(
    `SELECT id,name,code,language,status,deleted_at FROM resource_guide_people
     WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
    [[...new Set(ids)].sort()],
  );
}

/** Caller holds the tour row for updates. All old/new guides are locked before checking anything. */
export async function prepareGuideServices(
  manager: EntityManager,
  tourId: string | null,
  inputs: TourGuideServiceInputDto[],
  onChange?: GuideServiceChangeHandler,
): Promise<PreparedService[]> {
  const stored = tourId
    ? await manager.query<StoredService[]>(
        `SELECT id,guide_id,guide_name,guide_code,language,remark,time_source,
      to_char(service_start_at,'YYYY-MM-DD HH24:MI') AS service_start_at,
      to_char(service_end_at,'YYYY-MM-DD HH24:MI') AS service_end_at
     FROM tour_guide_services WHERE tour_id=$1 ORDER BY service_start_at,service_end_at,id`,
        [tourId],
      )
    : [];
  const byId = new Map(stored.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const guides = await lockServiceGuides(manager, [
    ...stored.map((s) => s.guide_id),
    ...inputs.map((s) => s.guideId),
  ]);
  const byGuide = new Map(guides.map((g) => [g.id, g]));
  if (tourId) {
    const ratings = await manager.query<{ guide_id: string }[]>(
      `SELECT guide_id FROM tour_ratings WHERE tour_id=$1 AND
       (self_score IS NOT NULL OR manager_score IS NOT NULL OR collect_score IS NOT NULL OR operator_score IS NOT NULL
        OR bonus_car_purchase IS NOT NULL OR bonus_recommended_self_pay IS NOT NULL OR bonus_praise IS NOT NULL
        OR bonus_designated IS NOT NULL OR bonus_incident IS NOT NULL)`,
      [tourId],
    );
    for (const rating of ratings) {
      if (!inputs.some((s) => s.guideId === rating.guide_id))
        throw new BusinessException({
          code: ErrorCode.CONFLICT,
          status: HttpStatus.CONFLICT,
          message: '已录入评分，不能移除该导游的最后一段服务',
          details: { guideId: rating.guide_id },
        });
    }
  }
  const prepared: PreparedService[] = [];
  for (const [index, input] of inputs.entries()) {
    const old = input.id ? byId.get(input.id) : undefined;
    if (input.id && (!old || seen.has(input.id)))
      reject('服务段ID重复或不属于当前团', index, input.id);
    if (input.id) seen.add(input.id);
    const timeUnchanged =
      !!old &&
      old.service_start_at === input.serviceStartAt &&
      old.service_end_at === input.serviceEndAt;
    const retained =
      old?.guide_id === input.guideId &&
      old.language === input.language &&
      timeUnchanged;
    const timeSource =
      old?.time_source === 'legacy' && timeUnchanged && !input.confirmTime
        ? 'legacy'
        : 'manual';
    try {
      validateServiceTimes(
        input.serviceStartAt,
        input.serviceEndAt,
        timeSource === 'legacy' && retained,
      );
    } catch {
      reject('服务开始须早于结束，且必须为真实日期时间', index, input.id);
    }
    for (const sibling of prepared) {
      if (
        sibling.input.guideId === input.guideId &&
        sibling.input.serviceStartAt <= input.serviceEndAt &&
        sibling.input.serviceEndAt >= input.serviceStartAt
      )
        reject(
          '同一导游的服务段时间冲突，同一分钟不能交接',
          index,
          input.id,
          true,
        );
    }
    const guide = byGuide.get(input.guideId);
    if (!retained) {
      if (!guide || guide.status !== 'enabled' || guide.deleted_at != null)
        reject('导游不可选', index, input.id);
      if (!input.language || guide.language?.trim() !== input.language)
        reject('导游语种与本段语种不匹配', index, input.id);
      const leave = await manager.query<unknown[]>(
        `SELECT 1 FROM resource_guide_leaves WHERE guide_person_id=$1 AND deleted_at IS NULL
         AND start_date < $3::timestamp + INTERVAL '1 day' AND end_date >= $2::timestamp::date LIMIT 1`,
        [
          input.guideId,
          input.serviceStartAt.slice(0, 10),
          input.serviceEndAt.slice(0, 10),
        ],
      );
      if (leave.length) reject('导游在该服务时段已请假', index, input.id, true);
      const busy = await manager.query<unknown[]>(
        `SELECT 1 FROM tour_guide_services s JOIN tours t ON t.id=s.tour_id
         WHERE s.guide_id=$1 AND t.status='active' AND s.service_start_at <= $3::timestamp
         AND s.service_end_at >= $2::timestamp AND ($4::uuid IS NULL OR t.id<>$4) LIMIT 1`,
        [input.guideId, input.serviceStartAt, input.serviceEndAt, tourId],
      );
      if (busy.length)
        reject('导游在该服务时段已有安排', index, input.id, true);
    }
    prepared.push({
      input,
      old,
      id: old?.id ?? randomUUID(),
      timeSource,
      guideName: old?.guide_id === input.guideId ? old.guide_name : guide!.name,
      guideCode: old?.guide_id === input.guideId ? old.guide_code : guide!.code,
    });
  }
  onChange?.({
    serviceIds: prepared.map((s) => s.id),
    guideIds: [...new Set(prepared.map((s) => s.input.guideId))],
    removedServiceIds: stored.filter((s) => !seen.has(s.id)).map((s) => s.id),
    removedGuideIds: [...new Set(stored.map((s) => s.guide_id))].filter(
      (id) => !inputs.some((s) => s.guideId === id),
    ),
  });
  return prepared;
}

export async function saveGuideServices(
  manager: EntityManager,
  tourId: string,
  services: PreparedService[],
  actorId: string,
): Promise<void> {
  await manager.query(
    `DELETE FROM tour_guide_services WHERE tour_id=$1 AND NOT (id=ANY($2::uuid[]))`,
    [tourId, services.map((s) => s.id)],
  );
  for (const service of services) {
    const { input, old } = service;
    if (
      old &&
      old.guide_id === input.guideId &&
      old.language === input.language &&
      old.service_start_at === input.serviceStartAt &&
      old.service_end_at === input.serviceEndAt &&
      old.remark === input.remark &&
      old.time_source === service.timeSource
    )
      continue;
    await manager.query(
      `INSERT INTO tour_guide_services
      (id,tour_id,guide_id,guide_name,guide_code,language,service_start_at,service_end_at,remark,time_source,created_by,updated_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
      ON CONFLICT (id) DO UPDATE SET guide_id=EXCLUDED.guide_id,guide_name=EXCLUDED.guide_name,guide_code=EXCLUDED.guide_code,
      language=EXCLUDED.language,service_start_at=EXCLUDED.service_start_at,service_end_at=EXCLUDED.service_end_at,
      remark=EXCLUDED.remark,time_source=EXCLUDED.time_source,updated_by=EXCLUDED.updated_by,updated_at=now()`,
      [
        service.id,
        tourId,
        input.guideId,
        service.guideName,
        service.guideCode,
        input.language,
        input.serviceStartAt,
        input.serviceEndAt,
        input.remark,
        service.timeSource,
        actorId,
      ],
    );
  }
  // Only empty rows can be detached; valued ratings were protected under the same tour lock.
  await manager.query(
    `DELETE FROM tour_ratings r WHERE r.tour_id=$1 AND NOT EXISTS
    (SELECT 1 FROM tour_guide_services s WHERE s.tour_id=r.tour_id AND s.guide_id=r.guide_id)`,
    [tourId],
  );
}
