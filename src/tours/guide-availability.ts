import { createHash } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import type {
  GuideBusyInputDto,
  GuideConflictLeaveResponse,
  GuideConflictTourResponse,
  GuideUnavailableReasonResponse,
  TourGuideOptionResponse,
  TourGuideQueryDto,
} from './tour.dto';

interface BusyTour extends GuideConflictTourResponse {
  serviceId: string;
}
export interface GuideAvailabilityRow extends TourGuideOptionResponse {
  status: string;
  leaves: GuideConflictLeaveResponse[];
  tours: BusyTour[];
}
export interface ConflictConfirmation {
  token: string;
  confirmedBy: string;
  confirmedByName: string;
  confirmedAt: string;
  reasons: GuideUnavailableReasonResponse[];
}

/** The same snapshot and fingerprint are used by search and the locked save. */
export function diagnoseGuide(
  guide: GuideAvailabilityRow,
  query: Pick<
    TourGuideQueryDto,
    | 'language'
    | 'serviceStartDate'
    | 'serviceEndDate'
    | 'excludeTourId'
    | 'otherServices'
  >,
) {
  const reasons: GuideUnavailableReasonResponse[] = [];
  if (guide.status !== 'enabled')
    reasons.push({ code: 'GUIDE_DISABLED', message: '该导游已停用' });
  if (guide.language?.trim() !== query.language.trim())
    reasons.push({
      code: 'LANGUAGE_MISMATCH',
      message: '该导游语种与本段要求不符',
      expectedLanguage: query.language.trim(),
      actualLanguage: guide.language,
    });
  if (guide.leaves.length)
    reasons.push({
      code: 'LEAVE_CONFLICT',
      message: '该导游在服务期间请假',
      leaves: guide.leaves,
    });
  if (guide.tours.length)
    reasons.push({
      code: 'SCHEDULE_CONFLICT',
      message: '该导游与已有团队服务排期冲突',
      tours: guide.tours.map(
        ({ tourNo, businessUnit, serviceStartDate, serviceEndDate }) => ({
          tourNo,
          businessUnit,
          serviceStartDate,
          serviceEndDate,
        }),
      ),
    });
  const siblings = (query.otherServices ?? []).flatMap((s, index) =>
    s.guideId.toLowerCase() === guide.id.toLowerCase() &&
    s.serviceStartDate <= query.serviceEndDate &&
    s.serviceEndDate >= query.serviceStartDate
      ? [
          {
            otherServiceIndex: index,
            serviceStartDate: s.serviceStartDate,
            serviceEndDate: s.serviceEndDate,
          },
        ]
      : [],
  );
  if (siblings.length)
    reasons.push({
      code: 'FORM_CONFLICT',
      message: '该导游与当前表单其他服务段冲突',
      services: siblings,
    });
  const canOverride =
    reasons.length > 0 &&
    reasons.every(
      (r) => r.code === 'SCHEDULE_CONFLICT' || r.code === 'FORM_CONFLICT',
    );
  const token = canOverride
    ? createHash('sha256')
        .update(
          JSON.stringify({
            guideId: guide.id,
            language: query.language.trim(),
            from: query.serviceStartDate,
            to: query.serviceEndDate,
            tours: guide.tours
              .map((s) => [s.serviceId, s.serviceStartDate, s.serviceEndDate])
              .sort(),
            siblings: siblings
              .map((s) => [s.serviceStartDate, s.serviceEndDate])
              .sort(),
          }),
        )
        .digest('hex')
    : undefined;
  return { reasons, canOverride, scheduleConflictToken: token };
}

export async function loadGuideAvailability(
  manager: EntityManager,
  query: Pick<
    TourGuideQueryDto,
    | 'keyword'
    | 'language'
    | 'serviceStartDate'
    | 'serviceEndDate'
    | 'excludeTourId'
    | 'otherServices'
    | 'page'
    | 'pageSize'
  >,
  guideId?: string,
): Promise<{ total: number; rows: GuideAvailabilityRow[] }> {
  const siblings: GuideBusyInputDto[] = query.otherServices ?? [];
  const excluded = siblings
    .filter(
      (s) =>
        s.serviceStartDate <= query.serviceEndDate &&
        s.serviceEndDate >= query.serviceStartDate,
    )
    .map((s) => s.guideId);
  const [result] = await manager.query<
    { total: number; rows: GuideAvailabilityRow[] }[]
  >(
    `WITH candidates AS (
    SELECT g.id,g.code,g.name,g.language,g.status,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('startDate',l.start_date::text,'endDate',l.end_date::text) ORDER BY l.start_date,l.end_date,l.id)
        FROM resource_guide_leaves l WHERE l.guide_person_id=g.id AND l.deleted_at IS NULL AND l.start_date<=$2::date AND l.end_date>=$1::date),'[]'::jsonb) AS leaves,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('serviceId',s.id,'tourNo',t.tour_no,'businessUnit',t.business_unit,
        'serviceStartDate',s.service_start_at::date::text,'serviceEndDate',s.service_end_at::date::text) ORDER BY s.id)
        FROM tour_guide_services s JOIN tours t ON t.id=s.tour_id WHERE s.guide_id=g.id AND t.status='active'
          AND s.service_start_at::date<=$2::date AND s.service_end_at::date>=$1::date AND ($3::uuid IS NULL OR t.id<>$3)),'[]'::jsonb) AS tours
    FROM resource_guide_people g WHERE g.deleted_at IS NULL
      AND ($5::uuid IS NULL OR g.id=$5) AND ($4::text='' OR strpos(lower(g.name),lower($4))>0)
  ), eligible AS (SELECT * FROM candidates WHERE $5::uuid IS NOT NULL OR $4::text<>'' OR
    (status='enabled' AND btrim(language)=$6 AND leaves='[]'::jsonb AND tours='[]'::jsonb AND NOT(id=ANY($7::uuid[]))))
  SELECT (SELECT count(*)::int FROM eligible) AS total,
    COALESCE((SELECT jsonb_agg(p ORDER BY p.code,p.id) FROM (SELECT * FROM eligible ORDER BY code,id LIMIT $8 OFFSET $9) p),'[]'::jsonb) AS rows`,
    [
      query.serviceStartDate,
      query.serviceEndDate,
      query.excludeTourId ?? null,
      query.keyword?.trim() ?? '',
      guideId ?? null,
      query.language.trim(),
      excluded,
      query.pageSize,
      (query.page - 1) * query.pageSize,
    ],
  );
  return result;
}
