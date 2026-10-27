import { HttpStatus, Injectable } from '@nestjs/common';
import {
  guideServicesJson,
  lockServiceGuides,
  prepareGuideServices,
  saveGuideServices,
} from './tour-guide-services';
import type {
  TourGuideService,
  GuideServiceChangeHandler,
} from './tour-guide-services';
import { DataSource, EntityManager } from 'typeorm';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  buildTourMap,
  loadMapPlans,
  CityLocation,
  MapTourRow,
} from './tour-map';
import { TourMapQuery, MapBusinessUnit } from './tour-map.dto';
import { FlightMapQuery, FlightMapResponse } from './flight-map.dto';
import { buildFlightMap, FlightMapRow } from './flight-map';
import { ErrorCode, ErrorCodeValue } from '../common/constants/error-code';
import { BusinessException } from '../common/exceptions/business.exception';
import type { PageResult } from '../common/types/page-result';
import { countryCatalog } from '../system/business-dictionaries/dictionary-catalogs';
import {
  CancelTourDto,
  TourFilterOptionsQueryDto,
  CreateTourDto,
  ManualTourSourceDto,
  TourScheduleDto,
  RatingQueryDto,
  RatingScoreDto,
  TourFlightQueryDto,
  TourFlightOptionResponse,
  TourGuideQueryDto,
  TourLanguageQueryDto,
  TourInputDto,
  TourQueryDto,
  TourSourceQueryDto,
  UpdateTourDto,
} from './tour.dto';
import {
  BASE_FIELDS,
  BONUS_FIELDS,
  RatingInput,
  pickTourNumber,
  ratingStats,
  manualTourSchedule,
  tourNumberBase,
  tourSchedule,
  validateServiceTimes,
} from './tour-rules';

type Unit = 'shengxu' | 'linxi' | 'website';
type Source = 'standard' | 'website';
type Row = Record<string, unknown>;

function fail(
  code: ErrorCodeValue,
  message: string,
  status: HttpStatus,
  details?: Record<string, unknown>,
): never {
  throw new BusinessException({ code, message, status, details });
}
const invalid = (message: string): never =>
  fail(ErrorCode.VALIDATION_ERROR, message, HttpStatus.BAD_REQUEST);
const conflict = (message: string): never =>
  fail(ErrorCode.CONFLICT, message, HttpStatus.CONFLICT);
const forbidden = (): never =>
  fail(ErrorCode.AUTH_FORBIDDEN, '没有权限执行此操作', HttpStatus.FORBIDDEN);
const notFound = (): never =>
  fail(ErrorCode.NOT_FOUND, '旅行团不存在', HttpStatus.NOT_FOUND);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Rating columns keyed by API field name. */
const RATING_COLUMNS: Record<string, string> = {
  selfScore: 'self_score',
  managerScore: 'manager_score',
  collectScore: 'collect_score',
  operatorScore: 'operator_score',
  carPurchase: 'bonus_car_purchase',
  recommendedSelfPay: 'bonus_recommended_self_pay',
  praise: 'bonus_praise',
  designated: 'bonus_designated',
  incident: 'bonus_incident',
};
const RATING_FIELDS = Object.keys(RATING_COLUMNS);
const RATING_SELECT = RATING_FIELDS.map(
  (f) => `r.${RATING_COLUMNS[f]}::float8 AS "${f}"`,
).join(',');

const TOUR_SELECT = `t.id, t.tour_no AS "tourNo", t.source_module AS "sourceModule", t.business_unit AS "businessUnit",
  t.inquiry_id AS "inquiryId", t.quote_id AS "quoteId", t.itinerary_id AS "itineraryId",
  t.inquiry_code AS "inquiryCode", t.itinerary_code AS "itineraryCode", t.quote_code AS "quoteCode",
  t.agency_id AS "agencyId", t.agency_name AS "agencyName", t.contact_name AS "contactName", t.days, t.start_date::text AS "startDate",
  to_char(t.pickup_at,'YYYY-MM-DD HH24:MI') AS "pickupAt", to_char(t.drop_at,'YYYY-MM-DD HH24:MI') AS "dropAt",
  t.occupy_from::text AS "occupyFrom", t.occupy_to::text AS "occupyTo",
  t.country_item_id AS "countryItemId", t.country_code AS "countryCode", t.country_name AS "countryName",
  t.creator_id AS "creatorId", t.creator_tour_code AS "creatorTourCode",
  t.collect_coordinator_id AS "collectCoordinatorId", t.collect_coordinator_name AS "collectCoordinatorName",
  t.operator_id AS "operatorId", t.operator_name AS "operatorName",
  t.adults, t.children, t.leaders, (t.adults + t.children + t.leaders) AS "totalPeople",
  t.language, t.shopping, t.pickup_flight_id AS "pickupFlightId", t.drop_flight_id AS "dropFlightId",
  t.pickup_flight AS "pickupFlight", t.drop_flight AS "dropFlight",
  t.schedule_mode AS "scheduleMode", t.itinerary_summary AS "itinerarySummary",
  ${guideServicesJson('t')} AS "guideServices", t.remark, t.status,
  t.cancelled_at AS "cancelledAt", t.cancel_reason AS "cancelReason", t.version,
  t.created_at AS "createdAt", t.updated_at AS "updatedAt"`;
const TOUR_FROM = `tours t`;

interface Resolved {
  module: Source | 'manual';
  inquiryId: string | null;
  inquiryCode: string | null;
  businessUnit: Unit;
  status: string;
  ownerId: string;
  ownerName: string;
  agencyId?: string | null;
  agencyName: string;
  contactName: string;
  countryItemId: string | null;
  countryCode: string | null;
  countryName: string;
  quoteId: string | null;
  quoteCode: string | null;
  itineraryId: string | null;
  itineraryCode: string | null;
  startDate: string | null;
  days: number;
  downloaded: boolean;
  itinerarySummary?: string;
}

@Injectable()
export class ToursService {
  constructor(private readonly db: DataSource) {}

  // ---------- access ----------
  private isAdmin(user: AuthenticatedUser) {
    return (
      user.roles.includes('ROOT') || user.roles.includes('BUSINESS_MANAGER')
    );
  }
  private require(user: AuthenticatedUser, permission: string) {
    if (!user.permissions.includes(permission)) forbidden();
  }
  /** Units an actor may work in; headquarters sees every unit. */
  private unitAllowed(user: AuthenticatedUser, unit: Unit) {
    return user.scope === 'headquarters' || user.scope === unit;
  }
  /** Appends the visibility filter for tours aliased as `t`. */
  private visible(user: AuthenticatedUser, params: unknown[]): string {
    if (user.scope === 'headquarters') return '';
    let sql = ` AND t.business_unit = $${params.push(user.scope)}`;
    if (!this.isAdmin(user)) {
      const p = `$${params.push(user.id)}`;
      sql += ` AND (t.collect_coordinator_id = ${p} OR t.operator_id = ${p} OR t.creator_id = ${p})`;
    }
    return sql;
  }
  /** Own-tour rule for writes: coordinators touch only their own tours. */
  private canManage(user: AuthenticatedUser, tour: Row) {
    if (!this.unitAllowed(user, tour.business_unit as Unit)) return false;
    if (this.isAdmin(user)) return true;
    return [
      tour.collect_coordinator_id,
      tour.operator_id,
      tour.creator_id,
    ].includes(user.id);
  }

  // ---------- reads ----------
  async flightMap(
    query: FlightMapQuery,
    user: AuthenticatedUser,
  ): Promise<FlightMapResponse> {
    this.require(user, 'tour:list');
    if (query.businessUnit && !this.unitAllowed(user, query.businessUnit))
      forbidden();
    const date =
      query.date ??
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
    const canSelect = user.scope === 'headquarters';
    const unit = canSelect
      ? (query.businessUnit ?? null)
      : (user.scope as MapBusinessUnit);
    const params: unknown[] = [date];
    let where = `t.status='active' AND leg.event_at >= $1::date
      AND leg.event_at < $1::date + INTERVAL '1 day'${this.visible(user, params)}`;
    if (query.businessUnit)
      where += ` AND t.business_unit=$${params.push(query.businessUnit)}`;
    // The outbound flight can depart after midnight, beyond the tour's occupancy end date.
    // One statement supplies one consistent snapshot; no itinerary/quote queries or N+1 reads.
    const rows = await this.db.query<FlightMapRow[]>(
      `SELECT t.id,t.tour_no AS "tourNo",t.business_unit AS "businessUnit",
        t.source_module AS "sourceModule",t.schedule_mode AS "scheduleMode",
        (t.adults+t.children+t.leaders) AS "totalPeople",leg.kind,
        to_char(leg.event_at,'YYYY-MM-DD HH24:MI') AS "scheduledAt",leg.flight
       FROM tours t CROSS JOIN LATERAL (
         VALUES ('pickup',t.pickup_at,t.pickup_flight),
           ('drop',CASE WHEN t.schedule_mode='flight' THEN t.drop_at + INTERVAL '3 hours'
             ELSE t.drop_at END,t.drop_flight)
       ) AS leg(kind,event_at,flight)
       WHERE ${where} ORDER BY leg.event_at,t.tour_no,t.id,leg.kind`,
      params,
    );
    return buildFlightMap(date, unit, canSelect, rows);
  }

  async map(query: TourMapQuery, user: AuthenticatedUser) {
    this.require(user, 'tour:list');
    if (query.businessUnit && !this.unitAllowed(user, query.businessUnit))
      forbidden();
    const date =
      query.date ??
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
    const canSelect = user.scope === 'headquarters';
    const unit = canSelect
      ? (query.businessUnit ?? null)
      : (user.scope as MapBusinessUnit);
    return this.db.transaction('REPEATABLE READ', async (manager) => {
      const params: unknown[] = [date];
      let where = `t.status='active' AND t.occupy_from <= $1::date AND t.occupy_to >= $1::date${this.visible(user, params)}`;
      if (query.businessUnit)
        where += ` AND t.business_unit=$${params.push(query.businessUnit)}`;
      const rows = await manager.query<MapTourRow[]>(
        `SELECT t.id,t.tour_no AS "tourNo",t.business_unit AS "businessUnit",t.source_module AS "sourceModule",
          t.adults,t.children,t.leaders,(t.adults+t.children+t.leaders) AS "totalPeople",t.days,
          ${guideServicesJson('t')} AS "guideServices",t.collect_coordinator_name AS "collectCoordinatorName",t.operator_name AS "operatorName",
          to_char(t.pickup_at,'YYYY-MM-DD HH24:MI') AS "pickupAt",to_char(t.drop_at,'YYYY-MM-DD HH24:MI') AS "dropAt",
          t.pickup_flight AS "pickupFlight",t.drop_flight AS "dropFlight"
         FROM tours t WHERE ${where} ORDER BY t.start_date,t.tour_no,t.id`,
        params,
      );
      const cities = await manager.query<CityLocation[]>(
        `SELECT id,name,province,status,longitude,latitude FROM resource_cities WHERE deleted_at IS NULL ORDER BY code,id`,
      );
      const plans = await loadMapPlans(
        manager,
        rows.map((row) => row.id),
      );
      for (const row of rows) {
        row.todayGuideServices = row.guideServices.filter(
          (service) =>
            service.serviceStartAt.slice(0, 10) <= date &&
            service.serviceEndAt.slice(0, 10) >= date,
        );
      }
      return buildTourMap(date, unit, canSelect, rows, cities, plans);
    });
  }

  async countActive(from: string, until: string, user: AuthenticatedUser) {
    this.require(user, 'tour:list');
    const params: unknown[] = [];
    const where = `WHERE t.status='active'${this.visible(user, params)}`;
    const rows = await this.db.query<
      { active: string; departingThisWeek: string }[]
    >(
      `SELECT COUNT(*) AS active,
       COUNT(*) FILTER (WHERE t.start_date >= $${params.push(from)} AND t.start_date < $${params.push(until)}) AS "departingThisWeek"
       FROM ${TOUR_FROM} ${where}`,
      params,
    );
    return {
      active: Number(rows[0].active),
      departingThisWeek: Number(rows[0].departingThisWeek),
    };
  }

  async countDeparturesByDate(
    from: string,
    until: string,
    user: AuthenticatedUser,
  ) {
    this.require(user, 'tour:list');
    const params: unknown[] = [];
    const where = `WHERE t.status='active'${this.visible(user, params)}`;
    return this.db.query<{ date: string; count: string }[]>(
      `SELECT t.start_date::text AS date, COUNT(*) AS count FROM ${TOUR_FROM} ${where}
       AND t.start_date >= $${params.push(from)} AND t.start_date < $${params.push(until)} GROUP BY t.start_date`,
      params,
    );
  }

  async filterOptions(
    query: TourFilterOptionsQueryDto,
    actor: AuthenticatedUser,
  ) {
    this.require(actor, 'tour:list');
    const params: unknown[] = [];
    let where = `WHERE true${this.visible(actor, params)}`;
    if (query.businessUnit)
      where += ` AND t.business_unit=$${params.push(query.businessUnit)}`;
    const [idColumn, nameColumn] = {
      collectCoordinator: [
        't.collect_coordinator_id',
        't.collect_coordinator_name',
      ],
      operator: ['t.operator_id', 't.operator_name'],
      agency: ['t.agency_name', 't.agency_name'],
    }[query.kind];
    where += ` AND ${idColumn} IS NOT NULL`;
    const snapshots = `SELECT DISTINCT ON (${idColumn}) ${idColumn}::text AS id, ${nameColumn} AS name
      FROM tours t ${where} ORDER BY ${idColumn}, t.updated_at DESC, t.id DESC`;
    const search = query.keyword?.trim()
      ? `WHERE name ILIKE $${params.push(`%${query.keyword.trim()}%`)}`
      : '';
    const [count] = await this.db.query<{ total: string }[]>(
      `SELECT count(*) AS total FROM (${snapshots}) options ${search}`,
      params,
    );
    const list = await this.db.query<{ id: string; name: string }[]>(
      `SELECT id,name FROM (${snapshots}) options ${search} ORDER BY name,id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.pageSize, (query.page - 1) * query.pageSize],
    );
    return {
      list,
      total: Number(count.total),
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async list(
    query: TourQueryDto,
    user: AuthenticatedUser,
  ): Promise<PageResult<Row>> {
    this.require(user, 'tour:list');
    const params: unknown[] = [];
    let where = `WHERE true${this.visible(user, params)}`;
    if (query.businessUnit)
      where += ` AND t.business_unit = $${params.push(query.businessUnit)}`;
    if (query.from && query.to && query.from > query.to)
      invalid('开始日期不能晚于结束日期');
    if (query.collectCoordinatorId)
      where += ` AND t.collect_coordinator_id=$${params.push(query.collectCoordinatorId)}`;
    if (query.operatorId)
      where += ` AND t.operator_id=$${params.push(query.operatorId)}`;
    if (query.agencyName !== undefined)
      where += ` AND t.agency_name=$${params.push(query.agencyName)}`;
    if (query.status) where += ` AND t.status = $${params.push(query.status)}`;
    if (query.guideId)
      where += ` AND EXISTS (SELECT 1 FROM tour_guide_services sg WHERE sg.tour_id=t.id AND sg.guide_id=$${params.push(query.guideId)})`;
    if (query.from) where += ` AND t.start_date >= $${params.push(query.from)}`;
    if (query.to) where += ` AND t.start_date <= $${params.push(query.to)}`;
    const keyword = query.keyword?.trim();
    if (keyword) {
      const p = `$${params.push(`%${keyword}%`)}`;
      where += ` AND (t.tour_no ILIKE ${p} OR t.inquiry_code ILIKE ${p} OR t.agency_name ILIKE ${p} OR t.contact_name ILIKE ${p})`;
    }
    const total = await this.db.query<{ count: string }[]>(
      `SELECT count(*) FROM ${TOUR_FROM} ${where}`,
      params,
    );
    const list = await this.db.query<Row[]>(
      `SELECT ${TOUR_SELECT} FROM ${TOUR_FROM} ${where}
       ORDER BY t.start_date DESC, t.created_at DESC, t.id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.pageSize, (query.page - 1) * query.pageSize],
    );
    return {
      list,
      total: Number(total[0].count),
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async get(id: string, user: AuthenticatedUser): Promise<Row> {
    this.require(user, 'tour:list');
    const params: unknown[] = [id];
    const rows = await this.db.query<Row[]>(
      `SELECT ${TOUR_SELECT} FROM ${TOUR_FROM} WHERE t.id = $1${this.visible(user, params)}`,
      params,
    );
    return rows[0] ?? notFound();
  }

  /** Inquiries with a frozen quote and no active tour, newest quote first. */
  async sources(query: TourSourceQueryDto, user: AuthenticatedUser) {
    this.require(user, 'tour:create');
    const params: unknown[] = [];
    const keyword = query.keyword?.trim();
    const like = keyword ? `$${params.push(`%${keyword}%`)}` : null;
    if (query.sourceModule === 'website') {
      if (!['linxi', 'website', 'headquarters'].includes(user.scope))
        forbidden();
      let scope =
        user.scope === 'headquarters'
          ? ''
          : ` AND i.business_unit=$${params.push(user.scope)}`;
      if (user.scope !== 'headquarters' && !this.isAdmin(user))
        scope += ` AND i.owner_id = $${params.push(user.id)}`;
      return this.db.query<Row[]>(
        `SELECT i.id AS "inquiryId", i.code AS "inquiryCode", i.customer_name AS "agencyName", '' AS "contactName",
          i.owner AS "ownerName", i.business_unit AS "businessUnit", i.country_code AS "countryCode",
          i.country_or_region AS "countryName", q.id AS "quoteId", q.code AS "quoteCode",
          it.code AS "itineraryCode", it.start_date::text AS "startDate", it.duration AS days,
          (q.first_downloaded_at IS NOT NULL) AS downloaded
         FROM website_inquiries i
         JOIN LATERAL (SELECT wq.* FROM website_quotations wq JOIN website_itineraries wi ON wi.id = wq.itinerary_id
           WHERE wi.inquiry_id = i.id ORDER BY wq.confirmed_at DESC, wq.id DESC LIMIT 1) q ON true
         JOIN website_itineraries it ON it.id = q.itinerary_id
         WHERE i.status NOT IN ('lost','archived')${scope}
           AND NOT EXISTS (SELECT 1 FROM tours t WHERE t.source_module='website' AND t.inquiry_id=i.id AND t.status='active')
           ${like ? `AND (i.code ILIKE ${like} OR i.customer_name ILIKE ${like})` : ''}
         ORDER BY q.confirmed_at DESC LIMIT 50`,
        params,
      );
    }
    let scope = '';
    if (user.scope !== 'headquarters') {
      scope = ` AND i.business_unit = $${params.push(user.scope)}`;
      if (!this.isAdmin(user))
        scope += ` AND i.owner_id = $${params.push(user.id)}`;
    }
    return this.db.query<Row[]>(
      `SELECT i.id AS "inquiryId", i.code AS "inquiryCode", i.agency_name AS "agencyName", i.contact_name AS "contactName",
        i.owner AS "ownerName", i.business_unit AS "businessUnit", i.country_code AS "countryCode",
        i.country_or_region AS "countryName", q.id AS "quoteId", q.quote_code AS "quoteCode",
        q.snapshot->'itinerary'->>'code' AS "itineraryCode", q.snapshot->'itinerary'->>'startDate' AS "startDate",
        (q.snapshot->'itinerary'->>'days')::int AS days, (q.first_downloaded_at IS NOT NULL) AS downloaded
       FROM inquiries i
       JOIN LATERAL (SELECT * FROM itinerary_quotes WHERE inquiry_id = i.id ORDER BY created_at DESC, id DESC LIMIT 1) q ON true
       WHERE i.status NOT IN ('lost','archived')${scope}
         AND NOT EXISTS (SELECT 1 FROM tours t WHERE t.source_module='standard' AND t.inquiry_id=i.id AND t.status='active')
         ${like ? `AND (i.code ILIKE ${like} OR i.agency_name ILIKE ${like} OR i.contact_name ILIKE ${like})` : ''}
       ORDER BY q.created_at DESC LIMIT 50`,
      params,
    );
  }

  async operators(businessUnit: Unit, user: AuthenticatedUser) {
    this.require(user, 'tour:list');
    if (!this.unitAllowed(user, businessUnit)) forbidden();
    return this.db.query<Row[]>(
      `SELECT u.id, u.nickname AS name FROM users u
       JOIN user_identities i ON i.user_id = u.id AND i.scope = $1
       WHERE u.status = 'enabled' AND u.deleted_at IS NULL AND EXISTS (
         SELECT 1 FROM identity_roles ir JOIN roles r ON r.id = ir.role_id
         WHERE ir.identity_id = i.id AND r.code = 'COORDINATOR' AND r.is_enabled)
       ORDER BY u.nickname, u.id`,
      [businessUnit],
    );
  }

  async flights(
    query: TourFlightQueryDto,
    user: AuthenticatedUser,
  ): Promise<PageResult<TourFlightOptionResponse>> {
    this.require(user, 'tour:list');
    const unit = query.businessUnit ?? (user.scope as Unit);
    if (
      !['shengxu', 'linxi', 'website'].includes(unit) ||
      !this.unitAllowed(user, unit)
    )
      forbidden();
    const params: unknown[] = [];
    const keyword = query.keyword?.trim();
    const where = keyword
      ? ` AND (f.flight_number ILIKE $${params.push(`%${keyword}%`)} OR d.code ILIKE $${params.length} OR a.code ILIKE $${params.length} OR d.name ILIKE $${params.length} OR a.name ILIKE $${params.length} OR d.english_name ILIKE $${params.length} OR a.english_name ILIKE $${params.length})`
      : '';
    const from = `FROM resource_flights f
       JOIN system_business_dictionary_items d ON d.id = f.departure_airport_id
       JOIN system_business_dictionary_items a ON a.id = f.arrival_airport_id
       WHERE f.status = 'enabled' AND f.deleted_at IS NULL
         AND d.status = 'enabled' AND d.deleted_at IS NULL AND a.status = 'enabled' AND a.deleted_at IS NULL${where}`;
    const [count] = await this.db.query<{ total: string }[]>(
      `SELECT count(*) AS total ${from}`,
      params,
    );
    const list = await this.db.query<TourFlightOptionResponse[]>(
      `SELECT f.id, f.flight_number AS "flightNumber", f.departure_time AS "departureTime", f.arrival_time AS "arrivalTime",
        d.code AS "departureCode", d.name AS "departureName", d.english_name AS "departureEnglishName",
        a.code AS "arrivalCode", a.name AS "arrivalName", a.english_name AS "arrivalEnglishName"
       ${from}
       ORDER BY f.flight_number, f.departure_time, f.id
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.pageSize, (query.page - 1) * query.pageSize],
    );
    return {
      list,
      total: Number(count.total),
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async guideLanguages(query: TourLanguageQueryDto, user: AuthenticatedUser) {
    this.require(user, 'tour:list');
    const params: unknown[] = [];
    let where =
      "WHERE status='enabled' AND deleted_at IS NULL AND length(btrim(language)) BETWEEN 1 AND 100";
    if (query.keyword?.trim())
      where += ` AND btrim(language) ILIKE $${params.push(`%${query.keyword.trim()}%`)}`;
    const [count] = await this.db.query<{ total: string }[]>(
      `SELECT count(DISTINCT btrim(language)) AS total FROM resource_guide_people ${where}`,
      params,
    );
    const list = await this.db.query<{ id: string; name: string }[]>(
      `SELECT DISTINCT btrim(language) AS id, btrim(language) AS name FROM resource_guide_people ${where}
       ORDER BY name LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.pageSize, (query.page - 1) * query.pageSize],
    );
    return {
      list,
      total: Number(count.total),
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** Advisory availability for one independent service interval and its unsaved siblings. */
  async availableGuides(query: TourGuideQueryDto, user: AuthenticatedUser) {
    this.require(user, 'tour:list');
    if (!this.unitAllowed(user, query.businessUnit)) forbidden();
    const existing = query.excludeTourId
      ? await this.get(query.excludeTourId, user)
      : null;
    if (existing && existing.businessUnit !== query.businessUnit) forbidden();
    try {
      validateServiceTimes(query.serviceStartAt, query.serviceEndAt);
      for (const other of query.otherServices ?? [])
        validateServiceTimes(other.serviceStartAt, other.serviceEndAt, true);
    } catch {
      invalid('服务起止时间无效');
    }
    const blocked = (query.otherServices ?? [])
      .filter(
        (other) =>
          other.serviceStartAt <= query.serviceEndAt &&
          other.serviceEndAt >= query.serviceStartAt,
      )
      .map((other) => other.guideId);
    return this.db.query<Row[]>(
      `SELECT g.id,g.code,g.name,g.language FROM resource_guide_people g
       WHERE g.status='enabled' AND g.deleted_at IS NULL AND btrim(g.language)=$4
       AND NOT (g.id=ANY($5::uuid[]))
       AND NOT EXISTS (SELECT 1 FROM resource_guide_leaves l WHERE l.guide_person_id=g.id AND l.deleted_at IS NULL
         AND l.start_date <= $2::timestamp::date AND l.end_date >= $1::timestamp::date)
       AND NOT EXISTS (SELECT 1 FROM tour_guide_services s JOIN tours t ON t.id=s.tour_id
         WHERE s.guide_id=g.id AND t.status='active' AND s.service_start_at <= $2::timestamp
         AND s.service_end_at >= $1::timestamp AND ($3::uuid IS NULL OR t.id<>$3))
       ORDER BY g.code,g.id`,
      [
        query.serviceStartAt,
        query.serviceEndAt,
        query.excludeTourId ?? null,
        query.language,
        blocked,
      ],
    );
  }

  // ---------- writes ----------
  private schedule(
    start: string,
    days: number,
    arrival: string,
    departure: string,
  ) {
    try {
      return tourSchedule(start, days, arrival, departure);
    } catch {
      return invalid('行程日期或航班时刻无效');
    }
  }

  private async booking(
    manager: EntityManager,
    input: TourScheduleDto,
    startDate: string,
    days: number,
    existing: Row | null = null,
  ) {
    if (input.scheduleMode === 'manual') {
      if (
        input.pickupFlightId !== undefined ||
        input.dropFlightId !== undefined
      )
        invalid('手填接送时间不能同时选择航班');
      try {
        return {
          pickup: null,
          drop: null,
          schedule: manualTourSchedule(
            startDate,
            input.pickupAt!,
            input.dropAt!,
          ),
        };
      } catch {
        return invalid('接送时间无效：接团日须为开始日期，送团不得早于接团');
      }
    }
    if (input.pickupAt !== undefined || input.dropAt !== undefined)
      invalid('航班计算模式不能同时手填接送时间');
    if (!input.pickupFlightId || !input.dropFlightId) invalid('请选择接送航班');
    const pickup =
      existing && existing.pickupFlightId === input.pickupFlightId
        ? (existing.pickupFlight as ReturnType<ToursService['flightSnapshot']>)
        : this.flightSnapshot(
            await this.flight(manager, input.pickupFlightId!),
          );
    const drop =
      existing && existing.dropFlightId === input.dropFlightId
        ? (existing.dropFlight as ReturnType<ToursService['flightSnapshot']>)
        : this.flightSnapshot(await this.flight(manager, input.dropFlightId!));
    return {
      pickup,
      drop,
      schedule: this.schedule(
        startDate,
        days,
        pickup.arrivalTime,
        drop.departureTime,
      ),
    };
  }

  private async manualSource(
    manager: EntityManager,
    input: ManualTourSourceDto,
    user: AuthenticatedUser,
    existing?: Row,
  ): Promise<Resolved> {
    if (!this.unitAllowed(user, input.businessUnit)) forbidden();
    if (
      existing &&
      (input.businessUnit !== existing.business_unit ||
        input.countryItemId !== existing.country_item_id)
    )
      invalid('手工团不能修改业务或国家');
    if (
      !this.isAdmin(user) &&
      input.collectCoordinatorId !== user.id &&
      input.collectCoordinatorId !== existing?.collect_coordinator_id
    )
      forbidden();
    const owner =
      existing?.collect_coordinator_id === input.collectCoordinatorId
        ? {
            id: input.collectCoordinatorId,
            name: existing.collect_coordinator_name as string,
          }
        : await this.operator(
            manager,
            input.collectCoordinatorId,
            input.businessUnit,
          );
    let agencyId: string | null = null;
    let agencyName = input.businessUnit === 'linxi' ? '霖熹' : '独立站';
    if (input.businessUnit === 'shengxu') {
      agencyId = input.agencyId ?? null;
      if (existing && agencyId === (existing.agency_id ?? null)) {
        agencyName = existing.agency_name as string;
      } else {
        this.require(user, 'resource:agency:list');
        if (!agencyId) invalid('请选择盛旭组团社');
        const [agency] = await manager.query<{ name: string }[]>(
          `SELECT name FROM resource_agencies WHERE id=$1 AND business_unit='shengxu'
           AND status='enabled' AND deleted_at IS NULL FOR SHARE`,
          [agencyId],
        );
        if (!agency) invalid('请选择启用的盛旭组团社');
        agencyName = agency.name;
      }
    } else if (input.agencyId != null) invalid('霖熹和独立站使用固定平台');
    const countries = existing
      ? [
          {
            code: existing.country_code as string,
            name: existing.country_name as string,
          },
        ]
      : await manager.query<{ code: string; name: string }[]>(
          `SELECT i.code, i.name FROM system_business_dictionary_items i JOIN system_business_dictionary_types t ON t.id=i.type_id WHERE i.id=$1 AND t.code='country-region' AND t.deleted_at IS NULL AND i.status='enabled' AND i.deleted_at IS NULL`,
          [input.countryItemId],
        );
    const country = countries[0];
    if (
      !country ||
      !countryCatalog().some((item) => item.code === country.code)
    )
      invalid('请选择有效的国家和地区');
    return {
      module: 'manual',
      inquiryId: null,
      inquiryCode: null,
      quoteId: null,
      quoteCode: null,
      itineraryId: null,
      itineraryCode: null,
      businessUnit: input.businessUnit,
      status: 'active',
      ownerId: owner.id,
      ownerName: owner.name,
      agencyId,
      agencyName,
      contactName: input.contactName,
      countryItemId: input.countryItemId,
      countryCode: country.code,
      countryName: country.name,
      startDate: input.startDate,
      days: input.days,
      itinerarySummary: input.itinerarySummary,
      downloaded: false,
    };
  }

  private async flight(manager: EntityManager, id: string) {
    const rows = await manager.query<
      {
        id: string;
        flightNumber: string;
        departureTime: string;
        arrivalTime: string;
        departure: Row;
        arrival: Row;
      }[]
    >(
      `SELECT f.id, f.flight_number AS "flightNumber", f.departure_time AS "departureTime", f.arrival_time AS "arrivalTime",
        jsonb_build_object('code', d.code, 'name', d.name, 'englishName', d.english_name) AS departure,
        jsonb_build_object('code', a.code, 'name', a.name, 'englishName', a.english_name) AS arrival
       FROM resource_flights f
       JOIN system_business_dictionary_items d ON d.id = f.departure_airport_id
       JOIN system_business_dictionary_items a ON a.id = f.arrival_airport_id
       WHERE f.id = $1 AND f.status = 'enabled' AND f.deleted_at IS NULL
         AND d.status = 'enabled' AND d.deleted_at IS NULL AND a.status = 'enabled' AND a.deleted_at IS NULL`,
      [id],
    );
    return rows[0] ?? invalid('航班不可选或缺少机场信息');
  }

  private async operator(manager: EntityManager, id: string, unit: Unit) {
    const rows = await manager.query<{ id: string; name: string }[]>(
      `SELECT u.id, u.nickname AS name FROM users u
       JOIN user_identities i ON i.user_id = u.id AND i.scope = $2
       WHERE u.id = $1 AND u.status = 'enabled' AND u.deleted_at IS NULL AND EXISTS (
         SELECT 1 FROM identity_roles ir JOIN roles r ON r.id = ir.role_id
         WHERE ir.identity_id = i.id AND r.code = 'COORDINATOR' AND r.is_enabled)`,
      [id, unit],
    );
    return rows[0] ?? invalid('操作计调必须是当前业务的启用计调');
  }

  private async validateLanguage(
    manager: EntityManager,
    language: string,
    existing?: Row,
  ) {
    if (!language || language === existing?.language) return;
    const rows = await manager.query<unknown[]>(
      `SELECT 1 FROM resource_guide_people WHERE status='enabled' AND deleted_at IS NULL AND btrim(language)=$1 LIMIT 1`,
      [language],
    );
    if (!rows.length) invalid('请选择已有导游的语种');
  }

  /** Resolves inquiry, its latest frozen quote and download state under a row lock. */
  private async resolve(
    manager: EntityManager,
    module: Source,
    inquiryId: string,
    user: AuthenticatedUser,
  ): Promise<Resolved> {
    if (module === 'website') {
      if (!['linxi', 'website', 'headquarters'].includes(user.scope))
        forbidden();
      const rows = await manager.query<Row[]>(
        `SELECT i.id, i.code, i.status, i.owner_id, i.owner, i.customer_name, i.country_item_id, i.country_code,
           i.country_or_region, i.business_unit FROM website_inquiries i WHERE i.id = $1 FOR UPDATE`,
        [inquiryId],
      );
      const i = rows[0];
      if (!i)
        fail(ErrorCode.INQUIRY_NOT_FOUND, '询盘不存在', HttpStatus.NOT_FOUND);
      if (
        !this.unitAllowed(user, i.business_unit as Unit) ||
        (user.scope !== 'headquarters' &&
          !this.isAdmin(user) &&
          i.owner_id !== user.id)
      )
        fail(ErrorCode.INQUIRY_NOT_FOUND, '询盘不存在', HttpStatus.NOT_FOUND);
      const q = await manager.query<Row[]>(
        `SELECT wq.id, wq.code, wq.first_downloaded_at, it.id AS itinerary_id, it.code AS itinerary_code,
           it.start_date::text AS start_date, it.duration
         FROM website_quotations wq JOIN website_itineraries it ON it.id = wq.itinerary_id
         WHERE it.inquiry_id = $1 ORDER BY wq.confirmed_at DESC, wq.id DESC LIMIT 1`,
        [inquiryId],
      );
      return this.assemble(module, i, i.business_unit as Unit, q[0], {
        startDate: q[0]?.start_date as string | null,
        days: Number(q[0]?.duration),
        agency: i.customer_name as string,
        contact: '',
        itineraryCode: q[0]?.itinerary_code as string,
      });
    }
    const rows = await manager.query<Row[]>(
      `SELECT i.id, i.code, i.status, i.owner_id, i.owner, i.business_unit, i.agency_name, i.contact_name,
         i.country_item_id, i.country_code, i.country_or_region FROM inquiries i WHERE i.id = $1 FOR UPDATE`,
      [inquiryId],
    );
    const i = rows[0];
    const inScope =
      i &&
      this.unitAllowed(user, i.business_unit as Unit) &&
      (user.scope === 'headquarters' ||
        this.isAdmin(user) ||
        i.owner_id === user.id);
    if (!i || !inScope)
      fail(ErrorCode.INQUIRY_NOT_FOUND, '询盘不存在', HttpStatus.NOT_FOUND);
    const q = await manager.query<Row[]>(
      `SELECT id, quote_code, first_downloaded_at, itinerary_id, snapshot FROM itinerary_quotes
       WHERE inquiry_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
      [inquiryId],
    );
    const it = (
      q[0]?.snapshot as
        | { itinerary?: { code: string; startDate: string; days: number } }
        | undefined
    )?.itinerary;
    return this.assemble(module, i, i.business_unit as Unit, q[0], {
      startDate: it?.startDate ?? null,
      days: Number(it?.days),
      agency: i.agency_name as string,
      contact: i.contact_name as string,
      itineraryCode: it?.code ?? '',
    });
  }

  private assemble(
    module: Source,
    i: Row,
    unit: Unit,
    q: Row | undefined,
    extra: {
      startDate: string | null;
      days: number;
      agency: string;
      contact: string;
      itineraryCode: string;
    },
  ): Resolved {
    if (!q) conflict('询盘没有已冻结报价');
    return {
      module,
      inquiryId: i.id as string,
      inquiryCode: i.code as string,
      businessUnit: unit,
      status: i.status as string,
      ownerId: i.owner_id as string,
      ownerName: i.owner as string,
      agencyName:
        unit === 'shengxu'
          ? extra.agency
          : unit === 'linxi'
            ? '霖熹'
            : '独立站',
      contactName: extra.contact,
      countryItemId: i.country_item_id as string | null,
      countryCode: i.country_code as string | null,
      countryName: i.country_or_region as string,
      quoteId: (q as Row).id as string,
      quoteCode: ((q as Row).quote_code ?? (q as Row).code) as string,
      itineraryId: (q as Row).itinerary_id as string,
      itineraryCode: extra.itineraryCode,
      startDate: extra.startDate,
      days: extra.days,
      downloaded: (q as Row).first_downloaded_at != null,
    };
  }

  async create(
    input: CreateTourDto,
    user: AuthenticatedUser,
    onChange?: GuideServiceChangeHandler,
  ): Promise<Row> {
    this.require(user, 'tour:create');
    const id = await this.db.transaction(async (manager) => {
      let src: Resolved;
      if (input.sourceModule === 'manual') {
        if (
          !input.manualSource ||
          input.inquiryId !== undefined ||
          input.quoteId !== undefined
        )
          invalid('手工成团必须填写资料且不能关联询盘或报价');
        src = await this.manualSource(manager, input.manualSource!, user);
      } else {
        if (input.manualSource !== undefined || input.scheduleMode === 'manual')
          invalid('关联来源不能提交手工资料或手填时间');
        src = await this.resolve(
          manager,
          input.sourceModule,
          input.inquiryId!,
          user,
        );
        if (['lost', 'archived'].includes(src.status))
          fail(
            ErrorCode.INQUIRY_READ_ONLY,
            '已结束询盘不能成团',
            HttpStatus.CONFLICT,
          );
        const active = await manager.query<unknown[]>(
          `SELECT 1 FROM tours WHERE source_module = $1 AND inquiry_id = $2 AND status = 'active'`,
          [src.module, src.inquiryId],
        );
        if (active.length) conflict('询盘已有有效旅行团');
        if (src.quoteId !== input.quoteId)
          conflict('只能选择该询盘最新的已冻结报价');
        if (!src.downloaded) conflict('最新冻结报价尚未点击下载');
      }
      if (!src.startDate || !DATE_RE.test(src.startDate))
        invalid('行程缺少开始日期，不能成团');
      if (!src.countryItemId || !src.countryCode)
        invalid('询盘缺少国家和地区，请先补齐');
      if (!countryCatalog().some((item) => item.code === src.countryCode))
        invalid('询盘国家和地区代码无效');
      if (!Number.isInteger(src.days) || src.days < 1 || src.days > 365)
        invalid('行程天数无效');
      const creator = await manager.query<{ tour_code: string | null }[]>(
        'SELECT tour_code FROM users WHERE id = $1',
        [user.id],
      );
      const creatorCode = creator[0]?.tour_code;
      if (!creatorCode) invalid('当前账号未设置团号标识');
      const {
        pickup,
        drop,
        schedule: s,
      } = await this.booking(manager, input, src.startDate!, src.days);
      const operator = await this.operator(
        manager,
        input.operatorId,
        src.businessUnit,
      );
      await this.validateLanguage(manager, input.language);
      const services = await prepareGuideServices(
        manager,
        null,
        input.guideServices,
        onChange,
      );

      // Per creator and pickup date; gaps from cancelled tours are never reused.
      const counter = await manager.query<{ last_value: number }[]>(
        `INSERT INTO tour_number_counters (creator_id, pickup_date, last_value) VALUES ($1, $2, 1)
         ON CONFLICT (creator_id, pickup_date) DO UPDATE SET last_value = tour_number_counters.last_value + 1
         RETURNING last_value`,
        [user.id, src.startDate],
      );
      const sequence = counter[0].last_value;
      const base = tourNumberBase(
        src.businessUnit === 'shengxu'
          ? 'YNSS'
          : src.businessUnit === 'website'
            ? 'LYNX'
            : 'KMLX',
        src.startDate!,
        creatorCode!,
        src.countryCode!,
      );
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        base.head + base.tail,
      ]);
      const taken = await manager.query<{ tour_no: string }[]>(
        'SELECT tour_no FROM tours WHERE tour_no LIKE $1',
        [`${base.head}%${base.tail}`],
      );
      const tourNo = pickTourNumber(
        base,
        sequence,
        new Set(taken.map((r) => r.tour_no)),
      );
      const inserted = await manager.query<{ id: string }[]>(
        `INSERT INTO tours (tour_no, source_module, business_unit, inquiry_id, quote_id, itinerary_id,
          inquiry_code, itinerary_code, quote_code, agency_name, contact_name, days, start_date, pickup_at, drop_at,
          occupy_from, occupy_to, country_item_id, country_code, country_name, creator_id, creator_tour_code,
          creator_sequence, collect_coordinator_id, collect_coordinator_name, operator_id, operator_name,
          adults, children, leaders, language, shopping, pickup_flight_id, drop_flight_id, pickup_flight, drop_flight,
          remark, created_by, updated_by, schedule_mode, itinerary_summary, agency_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,
          $28,$29,$30,$31,$32,$33,$34,$35::jsonb,$36::jsonb,$37,$21,$21,$38,$39,$40) RETURNING id`,
        [
          tourNo,
          src.module,
          src.businessUnit,
          src.inquiryId,
          src.quoteId,
          src.itineraryId,
          src.inquiryCode,
          src.itineraryCode,
          src.quoteCode,
          src.agencyName,
          src.contactName,
          src.days,
          src.startDate,
          s.pickupAt,
          s.dropAt,
          s.occupyFrom,
          s.occupyTo,
          src.countryItemId,
          src.countryCode,
          src.countryName,
          user.id,
          creatorCode,
          sequence,
          src.ownerId,
          src.ownerName,
          operator.id,
          operator.name,
          input.adults,
          input.children,
          input.leaders,
          input.language,
          input.shopping,
          input.pickupFlightId ?? null,
          input.dropFlightId ?? null,
          pickup ? JSON.stringify(pickup) : null,
          drop ? JSON.stringify(drop) : null,
          input.remark,
          input.scheduleMode ?? 'flight',
          src.itinerarySummary ?? '',
          src.agencyId ?? null,
        ],
      );
      await saveGuideServices(manager, inserted[0].id, services, user.id);
      return inserted[0].id;
    });
    return this.get(id, user);
  }

  private flightSnapshot(f: {
    flightNumber: string;
    departureTime: string;
    arrivalTime: string;
    departure: Row;
    arrival: Row;
  }) {
    return {
      flightNumber: f.flightNumber,
      departureTime: f.departureTime,
      arrivalTime: f.arrivalTime,
      departureAirport: f.departure,
      arrivalAirport: f.arrival,
    };
  }

  private async lockTour(
    manager: EntityManager,
    id: string,
    user: AuthenticatedUser,
  ): Promise<Row> {
    const rows = await manager.query<Row[]>(
      `SELECT *, start_date::text AS start_date, to_char(pickup_at,'YYYY-MM-DD HH24:MI') AS pickup_at, to_char(drop_at,'YYYY-MM-DD HH24:MI') AS drop_at FROM tours WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const tour = rows[0];
    if (!tour || !this.unitAllowed(user, tour.business_unit as Unit))
      notFound();
    return tour;
  }
  private versionCheck(current: unknown, expected: number) {
    if (current !== expected)
      fail(ErrorCode.CONFLICT, '记录已更新，请重新加载', HttpStatus.CONFLICT, {
        currentVersion: current,
      });
  }
  async update(
    id: string,
    input: UpdateTourDto,
    user: AuthenticatedUser,
    onChange?: GuideServiceChangeHandler,
  ): Promise<Row> {
    this.require(user, 'tour:update');
    await this.db.transaction(async (manager) => {
      const tour = await this.lockTour(manager, id, user);
      if (!this.canManage(user, tour)) forbidden();
      if (tour.status !== 'active') conflict('已撤销的旅行团不能修改');
      this.versionCheck(tour.version, input.version);
      const unit = tour.business_unit as Unit;
      if (
        tour.source_module !== 'manual' &&
        (input.manualSource !== undefined || input.scheduleMode === 'manual')
      )
        invalid('关联来源不能提交手工资料或手填时间');
      const src = input.manualSource
        ? await this.manualSource(manager, input.manualSource, user, tour)
        : null;
      const operator =
        input.operatorId === tour.operator_id
          ? { id: input.operatorId, name: tour.operator_name as string }
          : await this.operator(manager, input.operatorId, unit);
      const {
        pickup: pickupSnapshot,
        drop: dropSnapshot,
        schedule: s,
      } = await this.booking(
        manager,
        input,
        src?.startDate ?? (tour.start_date as string),
        src?.days ?? (tour.days as number),
        {
          pickupFlightId: tour.pickup_flight_id,
          dropFlightId: tour.drop_flight_id,
          pickupFlight: tour.pickup_flight,
          dropFlight: tour.drop_flight,
        },
      );
      await this.validateLanguage(manager, input.language, tour);
      const services = await prepareGuideServices(
        manager,
        id,
        input.guideServices,
        onChange,
      );
      await manager.query(
        `UPDATE tours SET operator_id=$2, operator_name=$3, adults=$4, children=$5, leaders=$6, language=$7, shopping=$8,
          pickup_flight_id=$9, drop_flight_id=$10, pickup_flight=$11::jsonb, drop_flight=$12::jsonb,
          pickup_at=$13, drop_at=$14, occupy_from=$15, occupy_to=$16, remark=$17,
          schedule_mode=$19, itinerary_summary=$20,
          agency_name=$21, contact_name=$22, start_date=$23, days=$24, collect_coordinator_id=$25, collect_coordinator_name=$26, agency_id=$27,
          version=version+1, updated_at=now(), updated_by=$18 WHERE id=$1`,
        [
          id,
          operator.id,
          input.operatorId === tour.operator_id
            ? tour.operator_name
            : operator.name,
          input.adults,
          input.children,
          input.leaders,
          input.language,
          input.shopping,
          input.pickupFlightId ?? null,
          input.dropFlightId ?? null,
          pickupSnapshot ? JSON.stringify(pickupSnapshot) : null,
          dropSnapshot ? JSON.stringify(dropSnapshot) : null,
          s.pickupAt,
          s.dropAt,
          s.occupyFrom,
          s.occupyTo,
          input.remark,
          user.id,
          input.scheduleMode ?? 'flight',
          src?.itinerarySummary ?? tour.itinerary_summary,
          src?.agencyName ?? tour.agency_name,
          src?.contactName ?? tour.contact_name,
          src?.startDate ?? tour.start_date,
          src?.days ?? tour.days,
          src?.ownerId ?? tour.collect_coordinator_id,
          src?.ownerName ?? tour.collect_coordinator_name,
          src ? (src.agencyId ?? null) : tour.agency_id,
        ],
      );
      await saveGuideServices(manager, id, services, user.id);
    });
    return this.get(id, user);
  }

  async cancel(
    id: string,
    input: CancelTourDto,
    user: AuthenticatedUser,
  ): Promise<Row> {
    this.require(user, 'tour:cancel');
    await this.db.transaction(async (manager) => {
      const tour = await this.lockTour(manager, id, user);
      if (!this.canManage(user, tour)) forbidden();
      if (tour.status !== 'active') conflict('旅行团已撤销');
      this.versionCheck(tour.version, input.version);
      const guides = await manager.query<{ guide_id: string }[]>(
        'SELECT guide_id FROM tour_guide_services WHERE tour_id=$1',
        [id],
      );
      await lockServiceGuides(
        manager,
        guides.map((g) => g.guide_id),
      );
      await manager.query(
        `UPDATE tours SET status='cancelled', cancelled_at=now(), cancelled_by=$2, cancel_reason=$3,
         version=version+1, updated_at=now(), updated_by=$2 WHERE id=$1`,
        [id, user.id, input.reason],
      );
    });
    return this.get(id, user);
  }

  // ---------- ratings ----------
  private ratingStatsOf(values: RatingInput) {
    try {
      return ratingStats(values);
    } catch (error) {
      return invalid((error as Error).message);
    }
  }

  private ratingRow(row: Row, user: AuthenticatedUser) {
    const values: RatingInput = {};
    for (const f of [...BASE_FIELDS, ...BONUS_FIELDS])
      values[f] = (row[f] as number | null) ?? null;
    const stats = this.ratingStatsOf(values);
    return {
      tourId: row.id,
      tourNo: row.tourNo,
      status: row.status,
      businessUnit: row.businessUnit,
      startDate: row.startDate,
      guideId: row.guideId,
      guideName: row.guideName,
      guideCode: row.guideCode,
      guideServices: row.guideServices as TourGuideService[],
      collectCoordinatorName: row.collectCoordinatorName,
      operatorName: row.operatorName,
      ...values,
      ...stats,
      version: (row.ratingVersion as number | null) ?? 0,
      canEdit:
        row.status === 'active' &&
        user.permissions.includes('tour:rating:update') &&
        ((user.scope === 'headquarters' && user.roles.includes('ROOT')) ||
          row.collectCoordinatorId === user.id ||
          row.operatorId === user.id ||
          (user.roles.includes('BUSINESS_MANAGER') &&
            user.scope === row.businessUnit)),
    };
  }

  private ratingFrom = `tours t JOIN LATERAL (
    SELECT DISTINCT ON (sg.guide_id) sg.guide_id,sg.guide_name,sg.guide_code
    FROM tour_guide_services sg WHERE sg.tour_id=t.id
    ORDER BY sg.guide_id,sg.created_at,sg.id
  ) g ON true LEFT JOIN tour_ratings r ON r.tour_id=t.id AND r.guide_id=g.guide_id`;
  private ratingSelect = `SELECT ${TOUR_SELECT},g.guide_id AS "guideId",g.guide_name AS "guideName",g.guide_code AS "guideCode",
    ${guideServicesJson('t', 'g.guide_id')} AS "guideServices",${RATING_SELECT},r.version AS "ratingVersion"
    FROM ${this.ratingFrom}`;

  async ratings(
    query: RatingQueryDto,
    user: AuthenticatedUser,
  ): Promise<PageResult<Row>> {
    this.require(user, 'tour:rating:list');
    const params: unknown[] = [];
    let where = `WHERE true${this.visible(user, params)}`;
    if (query.guideId)
      where += ` AND g.guide_id = $${params.push(query.guideId)}`;
    const keyword = query.keyword?.trim();
    if (keyword) {
      const p = `$${params.push(`%${keyword}%`)}`;
      where += ` AND (t.tour_no ILIKE ${p} OR g.guide_name ILIKE ${p})`;
    }
    const total = await this.db.query<{ count: string }[]>(
      `SELECT count(*) FROM ${this.ratingFrom} ${where}`,
      params,
    );
    const rows = await this.db.query<Row[]>(
      `${this.ratingSelect} ${where} ORDER BY t.start_date DESC, t.created_at DESC, t.id,g.guide_id
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.pageSize, (query.page - 1) * query.pageSize],
    );
    return {
      list: rows.map((row) => this.ratingRow(row, user)),
      total: Number(total[0].count),
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async saveRating(
    id: string,
    guideId: string,
    input: RatingScoreDto,
    user: AuthenticatedUser,
  ): Promise<Row> {
    this.require(user, 'tour:rating:update');
    await this.db.transaction(async (manager) => {
      const tour = await this.lockTour(manager, id, user);
      // Coordinators rate when they collect or operate the tour; managers within their unit.
      const own =
        tour.collect_coordinator_id === user.id || tour.operator_id === user.id;
      const manages =
        user.roles.includes('BUSINESS_MANAGER') &&
        user.scope === tour.business_unit;
      const root = user.scope === 'headquarters' && user.roles.includes('ROOT');
      if (!own && !manages && !root) forbidden();
      if (tour.status !== 'active') conflict('已撤销的旅行团不能修改评分');
      const associated = await manager.query<unknown[]>(
        'SELECT 1 FROM tour_guide_services WHERE tour_id=$1 AND guide_id=$2 LIMIT 1',
        [id, guideId],
      );
      if (!associated.length) conflict('该导游在团内没有服务段，不能评分');
      const existing = (
        await manager.query<Row[]>(
          'SELECT * FROM tour_ratings WHERE tour_id = $1 AND guide_id=$2',
          [id, guideId],
        )
      )[0];
      this.versionCheck(existing ? existing.version : 0, input.version);
      const merged: RatingInput = {};
      for (const f of RATING_FIELDS) {
        const patch = (input as unknown as Row)[f] as number | null | undefined;
        const current = existing
          ? ((existing[RATING_COLUMNS[f]] as string | null) ?? null)
          : null;
        merged[f as keyof RatingInput] =
          patch !== undefined
            ? patch
            : current == null
              ? null
              : Number(current);
      }
      this.ratingStatsOf(merged);
      const values = RATING_FIELDS.map(
        (f) => merged[f as keyof RatingInput] ?? null,
      );
      if (existing) {
        await manager.query(
          `UPDATE tour_ratings SET guide_id = $2, ${RATING_FIELDS.map((f, i) => `${RATING_COLUMNS[f]} = $${i + 3}`).join(', ')},
           version = version + 1, updated_at = now(), updated_by = $${RATING_FIELDS.length + 3} WHERE tour_id = $1 AND guide_id=$2`,
          [id, guideId, ...values, user.id],
        );
      } else {
        await manager.query(
          `INSERT INTO tour_ratings (tour_id, guide_id, ${RATING_FIELDS.map((f) => RATING_COLUMNS[f]).join(', ')}, created_by, updated_by)
           VALUES ($1, $2, ${RATING_FIELDS.map((_f, i) => `$${i + 3}`).join(', ')}, $${RATING_FIELDS.length + 3}, $${RATING_FIELDS.length + 3})`,
          [id, guideId, ...values, user.id],
        );
      }
    });
    const params: unknown[] = [id, guideId];
    const rows = await this.db.query<Row[]>(
      `${this.ratingSelect} WHERE t.id = $1 AND g.guide_id=$2${this.visible(user, params)}`,
      params,
    );
    return rows[0] ? this.ratingRow(rows[0], user) : notFound();
  }
}

export type { TourInputDto };
