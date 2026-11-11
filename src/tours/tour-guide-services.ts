import { randomUUID } from 'node:crypto';
import { HttpStatus } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { ErrorCode } from '../common/constants/error-code';
import { BusinessException } from '../common/exceptions/business.exception';
import type { TourGuideServiceInputDto } from './tour.dto';
import { validateServiceDates } from './tour-rules';
import {
  diagnoseGuide,
  loadGuideAvailability,
  ConflictConfirmation,
} from './guide-availability';
import type { GuideUnavailableReasonResponse } from './tour.dto';

export interface TourGuideService {
  id: string;
  tourId: string;
  guideId: string;
  guideName: string;
  guideCode: string;
  language: string;
  serviceStartDate: string;
  serviceEndDate: string;
  remark: string;
  timeSource: 'legacy' | 'manual';
  invalidDuration: boolean;
  outsideTourWindow: boolean;
  conflictConfirmation: ConflictConfirmation | null;
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
    'language',gs.language,'serviceStartDate',gs.service_start_at::date::text,
    'serviceEndDate',gs.service_end_at::date::text,'remark',gs.remark,'timeSource',gs.time_source,
    'invalidDuration',gs.service_start_at::date>gs.service_end_at::date,
    'conflictConfirmation',gs.conflict_confirmation,
    'outsideTourWindow',gs.service_start_at::date<${tourAlias}.pickup_at::date OR gs.service_end_at::date>${tourAlias}.drop_at::date,
    'createdAt',gs.created_at,'createdBy',gs.created_by,'updatedAt',gs.updated_at,'updatedBy',gs.updated_by
  ) ORDER BY gs.service_start_at::date,gs.service_end_at::date,gs.id)
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
  conflict_confirmation: ConflictConfirmation | null;
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
  confirmation?: { token: string; reasons: GuideUnavailableReasonResponse[] };
  retainedConfirmation?: ConflictConfirmation | null;
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
        `SELECT id,guide_id,guide_name,guide_code,language,remark,time_source,conflict_confirmation,
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
      old.service_start_at.slice(0, 10) === input.serviceStartDate &&
      old.service_end_at.slice(0, 10) === input.serviceEndDate;
    const retained =
      old?.guide_id === input.guideId &&
      old.language === input.language &&
      timeUnchanged;
    const timeSource =
      old?.time_source === 'legacy' && timeUnchanged && !input.confirmTime
        ? 'legacy'
        : 'manual';
    try {
      validateServiceDates(input.serviceStartDate, input.serviceEndDate);
    } catch {
      reject('服务开始日期不能晚于结束日期，且必须为真实日期', index, input.id);
    }
    const guide = byGuide.get(input.guideId);
    let confirmation: PreparedService['confirmation'];
    // Untouched historical rows retain their raw timestamps and do not invent consent.
    if (
      !retained ||
      input.scheduleConflictToken ||
      old?.conflict_confirmation
    ) {
      if (
        !retained &&
        (!guide || guide.status !== 'enabled' || guide.deleted_at != null)
      )
        reject('导游不可选', index, input.id);
      const query = {
        language: input.language,
        serviceStartDate: input.serviceStartDate,
        serviceEndDate: input.serviceEndDate,
        excludeTourId: tourId ?? undefined,
        otherServices: inputs.filter((_, i) => i !== index),
        page: 1,
        pageSize: 1,
      };
      const availability = await loadGuideAvailability(
        manager,
        query,
        input.guideId,
      );
      const row = availability.rows[0];
      if (!row) {
        if (!retained) reject('导游不可选', index, input.id);
      } else {
        const diagnosis = diagnoseGuide(
          retained
            ? {
                ...row,
                status: 'enabled',
                language: input.language,
                leaves: [],
              }
            : row,
          query,
        );
        const blockers = diagnosis.reasons.filter(
          (r) => r.code !== 'SCHEDULE_CONFLICT' && r.code !== 'FORM_CONFLICT',
        );
        if (!retained && blockers.length)
          reject(
            blockers.map((r) => r.message).join('；'),
            index,
            input.id,
            true,
          );
        if (
          diagnosis.reasons.some(
            (r) => r.code === 'SCHEDULE_CONFLICT' || r.code === 'FORM_CONFLICT',
          )
        ) {
          // Never turn a blocked candidate into an overrideable candidate.
          const token = diagnosis.scheduleConflictToken;
          const accepted =
            input.scheduleConflictToken ??
            (retained ? old?.conflict_confirmation?.token : undefined);
          if (!token || accepted !== token)
            throw new BusinessException({
              code: ErrorCode.CONFLICT,
              status: HttpStatus.CONFLICT,
              message: '排期冲突或冲突内容已变化，请重新查询并确认使用',
              details: {
                serviceIndex: index,
                serviceId: input.id ?? null,
                reason: 'GUIDE_SCHEDULE_CONFIRMATION_REQUIRED',
                ...diagnosis,
              },
            });
          if (token !== old?.conflict_confirmation?.token)
            confirmation = { token, reasons: diagnosis.reasons };
        }
      }
    }
    prepared.push({
      input,
      old,
      id: old?.id ?? randomUUID(),
      timeSource,
      confirmation,
      retainedConfirmation: retained ? old?.conflict_confirmation : null,
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
      old.service_start_at.slice(0, 10) === input.serviceStartDate &&
      old.service_end_at.slice(0, 10) === input.serviceEndDate &&
      old.remark === input.remark &&
      old.time_source === service.timeSource &&
      !service.confirmation
    )
      continue;
    const [confirmer] = service.confirmation
      ? await manager.query<{ nickname: string }[]>(
          'SELECT nickname FROM users WHERE id=$1',
          [actorId],
        )
      : [];
    const confirmation: ConflictConfirmation | null = service.confirmation
      ? {
          ...service.confirmation,
          confirmedBy: actorId,
          confirmedByName: confirmer.nickname,
          confirmedAt: new Date().toISOString(),
        }
      : (service.retainedConfirmation ?? null);
    const datesUnchanged =
      !input.confirmTime &&
      old?.service_start_at.slice(0, 10) === input.serviceStartDate &&
      old?.service_end_at.slice(0, 10) === input.serviceEndDate;
    await manager.query(
      `INSERT INTO tour_guide_services
      (id,tour_id,guide_id,guide_name,guide_code,language,service_start_at,service_end_at,remark,time_source,created_by,updated_by,conflict_confirmation)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12::jsonb)
      ON CONFLICT (id) DO UPDATE SET guide_id=EXCLUDED.guide_id,guide_name=EXCLUDED.guide_name,guide_code=EXCLUDED.guide_code,
      language=EXCLUDED.language,service_start_at=EXCLUDED.service_start_at,service_end_at=EXCLUDED.service_end_at,
      conflict_confirmation=EXCLUDED.conflict_confirmation,remark=EXCLUDED.remark,time_source=EXCLUDED.time_source,updated_by=EXCLUDED.updated_by,updated_at=now()`,
      [
        service.id,
        tourId,
        input.guideId,
        service.guideName,
        service.guideCode,
        input.language,
        datesUnchanged
          ? old.service_start_at
          : `${input.serviceStartDate} 00:00`,
        datesUnchanged ? old.service_end_at : `${input.serviceEndDate} 23:59`,
        input.remark,
        service.timeSource,
        actorId,
        confirmation ? JSON.stringify(confirmation) : null,
      ],
    );
    if (service.confirmation)
      await manager.query(
        `INSERT INTO tour_guide_conflict_confirmations(tour_id,service_id,guide_id,confirmation,created_by) VALUES($1,$2,$3,$4::jsonb,$5)`,
        [
          tourId,
          service.id,
          input.guideId,
          JSON.stringify(confirmation),
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
