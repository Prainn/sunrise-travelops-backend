import { HttpStatus, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ErrorCode, ErrorCodeValue } from '../common/constants/error-code';
import { BusinessException } from '../common/exceptions/business.exception';
import type { PageResult } from '../common/types/page-result';
import { countryCatalog } from '../system/business-dictionaries/dictionary-catalogs';
import {
  CancelTourDto,
  CreateTourDto,
  RatingQueryDto,
  RatingScoreDto,
  TourFlightQueryDto,
  TourGuideQueryDto,
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
  tourNumberBase,
  tourSchedule,
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

const libraryOf = (unit: Unit) => (unit === 'shengxu' ? 'shengxu' : 'shared');
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
  t.library, t.inquiry_id AS "inquiryId", t.quote_id AS "quoteId", t.itinerary_id AS "itineraryId",
  t.inquiry_code AS "inquiryCode", t.itinerary_code AS "itineraryCode", t.quote_code AS "quoteCode",
  t.agency_name AS "agencyName", t.contact_name AS "contactName", t.days, t.start_date::text AS "startDate",
  to_char(t.pickup_at,'YYYY-MM-DD HH24:MI') AS "pickupAt", to_char(t.drop_at,'YYYY-MM-DD HH24:MI') AS "dropAt",
  t.occupy_from::text AS "occupyFrom", t.occupy_to::text AS "occupyTo",
  t.country_item_id AS "countryItemId", t.country_code AS "countryCode", t.country_name AS "countryName",
  t.creator_id AS "creatorId", t.creator_tour_code AS "creatorTourCode",
  t.collect_coordinator_id AS "collectCoordinatorId", t.collect_coordinator_name AS "collectCoordinatorName",
  t.operator_id AS "operatorId", t.operator_name AS "operatorName",
  t.adults, t.children, t.leaders, (t.adults + t.children + t.leaders) AS "totalPeople",
  t.language, t.shopping, t.pickup_flight_id AS "pickupFlightId", t.drop_flight_id AS "dropFlightId",
  t.pickup_flight AS "pickupFlight", t.drop_flight AS "dropFlight",
  t.guide_id AS "guideId", g.name AS "guideName", g.code AS "guideCode", t.remark, t.status,
  t.cancelled_at AS "cancelledAt", t.cancel_reason AS "cancelReason", t.version,
  t.created_at AS "createdAt", t.updated_at AS "updatedAt"`;
const TOUR_FROM = `tours t LEFT JOIN resource_guide_people g ON g.id = t.guide_id`;

interface Resolved {
  module: Source;
  inquiryId: string;
  inquiryCode: string;
  businessUnit: Unit;
  status: string;
  ownerId: string;
  ownerName: string;
  agencyName: string;
  contactName: string;
  countryItemId: string | null;
  countryCode: string | null;
  countryName: string;
  quoteId: string;
  quoteCode: string;
  itineraryId: string;
  itineraryCode: string;
  startDate: string | null;
  days: number;
  downloaded: boolean;
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
  async list(
    query: TourQueryDto,
    user: AuthenticatedUser,
  ): Promise<PageResult<Row>> {
    this.require(user, 'tour:list');
    const params: unknown[] = [];
    let where = `WHERE true${this.visible(user, params)}`;
    if (query.businessUnit)
      where += ` AND t.business_unit = $${params.push(query.businessUnit)}`;
    if (query.status) where += ` AND t.status = $${params.push(query.status)}`;
    if (query.guideId)
      where += ` AND t.guide_id = $${params.push(query.guideId)}`;
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
      if (!['website', 'headquarters'].includes(user.scope)) forbidden();
      let scope = '';
      if (user.scope !== 'headquarters' && !this.isAdmin(user))
        scope = ` AND i.owner_id = $${params.push(user.id)}`;
      return this.db.query<Row[]>(
        `SELECT i.id AS "inquiryId", i.code AS "inquiryCode", i.customer_name AS "agencyName", '' AS "contactName",
          i.owner AS "ownerName", 'website' AS "businessUnit", i.country_code AS "countryCode",
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

  async flights(query: TourFlightQueryDto, user: AuthenticatedUser) {
    this.require(user, 'tour:list');
    const unit = query.businessUnit ?? (user.scope as Unit);
    if (
      !['shengxu', 'linxi', 'website'].includes(unit) ||
      !this.unitAllowed(user, unit)
    )
      forbidden();
    const params: unknown[] = [libraryOf(unit)];
    const keyword = query.keyword?.trim();
    const where = keyword
      ? ` AND (f.flight_number ILIKE $${params.push(`%${keyword}%`)} OR d.code ILIKE $${params.length} OR a.code ILIKE $${params.length} OR d.name ILIKE $${params.length} OR a.name ILIKE $${params.length} OR d.english_name ILIKE $${params.length} OR a.english_name ILIKE $${params.length})`
      : '';
    return this.db.query<Row[]>(
      `SELECT f.id, f.flight_number AS "flightNumber", f.departure_time AS "departureTime", f.arrival_time AS "arrivalTime",
        d.code AS "departureCode", d.name AS "departureName", d.english_name AS "departureEnglishName",
        a.code AS "arrivalCode", a.name AS "arrivalName", a.english_name AS "arrivalEnglishName"
       FROM resource_flights f
       JOIN system_business_dictionary_items d ON d.id = f.departure_airport_id
       JOIN system_business_dictionary_items a ON a.id = f.arrival_airport_id
       WHERE f.library = $1 AND f.status = 'enabled' AND f.deleted_at IS NULL
         AND d.status = 'enabled' AND d.deleted_at IS NULL AND a.status = 'enabled' AND a.deleted_at IS NULL${where}
       ORDER BY f.flight_number, f.departure_time, f.id`,
      params,
    );
  }

  /** Guides free for the whole occupancy window derived from the dates and flights. */
  async availableGuides(query: TourGuideQueryDto, user: AuthenticatedUser) {
    this.require(user, 'tour:list');
    if (!this.unitAllowed(user, query.businessUnit)) forbidden();
    const existing = query.excludeTourId
      ? await this.get(query.excludeTourId, user)
      : null;
    if (existing && existing.businessUnit !== query.businessUnit) forbidden();
    const [pickup, drop] = await Promise.all([
      existing?.pickupFlightId === query.pickupFlightId
        ? (existing.pickupFlight as { arrivalTime: string })
        : this.flight(
            this.db.manager,
            query.pickupFlightId,
            query.businessUnit,
          ),
      existing?.dropFlightId === query.dropFlightId
        ? (existing.dropFlight as { departureTime: string })
        : this.flight(this.db.manager, query.dropFlightId, query.businessUnit),
    ]);
    const s = this.schedule(
      existing ? (existing.startDate as string) : query.startDate,
      existing ? (existing.days as number) : query.days,
      pickup.arrivalTime,
      drop.departureTime,
    );
    return this.db.query<Row[]>(
      `SELECT g.id, g.code, g.name, g.language FROM resource_guide_people g
       WHERE g.library = $1 AND g.status = 'enabled' AND g.deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM resource_guide_leaves l WHERE l.guide_person_id = g.id AND l.deleted_at IS NULL
           AND l.start_date <= $3 AND l.end_date >= $2)
         AND NOT EXISTS (SELECT 1 FROM tours t WHERE t.guide_id = g.id AND t.status = 'active'
           AND t.occupy_from <= $3 AND t.occupy_to >= $2 AND ($4::uuid IS NULL OR t.id <> $4))
       ORDER BY g.code, g.id`,
      [
        libraryOf(query.businessUnit),
        s.occupyFrom,
        s.occupyTo,
        query.excludeTourId ?? null,
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

  private async flight(manager: EntityManager, id: string, unit: Unit) {
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
       WHERE f.id = $1 AND f.library = $2 AND f.status = 'enabled' AND f.deleted_at IS NULL
         AND d.status = 'enabled' AND d.deleted_at IS NULL AND a.status = 'enabled' AND a.deleted_at IS NULL`,
      [id, libraryOf(unit)],
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

  /** Locks the guide and rejects leave or tour overlap without naming other tours. */
  private async lockGuide(
    manager: EntityManager,
    guideId: string,
    unit: Unit,
    from: string,
    to: string,
    excludeTourId: string | null,
  ) {
    const guide = await manager.query<{ id: string }[]>(
      `SELECT id FROM resource_guide_people WHERE id = $1 AND library = $2 AND status = 'enabled'
       AND deleted_at IS NULL FOR UPDATE`,
      [guideId, libraryOf(unit)],
    );
    if (!guide[0]) invalid('导游不可选');
    const leave = await manager.query<unknown[]>(
      `SELECT 1 FROM resource_guide_leaves WHERE guide_person_id = $1 AND deleted_at IS NULL
       AND start_date <= $3 AND end_date >= $2 LIMIT 1`,
      [guideId, from, to],
    );
    if (leave.length) conflict('导游在该时段已请假');
    const busy = await manager.query<unknown[]>(
      `SELECT 1 FROM tours WHERE guide_id = $1 AND status = 'active'
       AND occupy_from <= $3 AND occupy_to >= $2 AND ($4::uuid IS NULL OR id <> $4) LIMIT 1`,
      [guideId, from, to, excludeTourId],
    );
    if (busy.length) conflict('导游在该时段已有其他团期');
  }

  /** Resolves inquiry, its latest frozen quote and download state under a row lock. */
  private async resolve(
    manager: EntityManager,
    module: Source,
    inquiryId: string,
    user: AuthenticatedUser,
  ): Promise<Resolved> {
    if (module === 'website') {
      if (!['website', 'headquarters'].includes(user.scope)) forbidden();
      const rows = await manager.query<Row[]>(
        `SELECT i.id, i.code, i.status, i.owner_id, i.owner, i.customer_name, i.country_item_id, i.country_code,
           i.country_or_region FROM website_inquiries i WHERE i.id = $1 FOR UPDATE`,
        [inquiryId],
      );
      const i = rows[0];
      if (!i)
        fail(ErrorCode.INQUIRY_NOT_FOUND, '询盘不存在', HttpStatus.NOT_FOUND);
      if (
        user.scope !== 'headquarters' &&
        !this.isAdmin(user) &&
        i.owner_id !== user.id
      )
        fail(ErrorCode.INQUIRY_NOT_FOUND, '询盘不存在', HttpStatus.NOT_FOUND);
      const q = await manager.query<Row[]>(
        `SELECT wq.id, wq.code, wq.first_downloaded_at, it.id AS itinerary_id, it.code AS itinerary_code,
           it.start_date::text AS start_date, it.duration
         FROM website_quotations wq JOIN website_itineraries it ON it.id = wq.itinerary_id
         WHERE it.inquiry_id = $1 ORDER BY wq.confirmed_at DESC, wq.id DESC LIMIT 1`,
        [inquiryId],
      );
      return this.assemble(module, i, 'website', q[0], {
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
      agencyName: extra.agency,
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

  async create(input: CreateTourDto, user: AuthenticatedUser): Promise<Row> {
    this.require(user, 'tour:create');
    const id = await this.db.transaction(async (manager) => {
      const src = await this.resolve(
        manager,
        input.sourceModule,
        input.inquiryId,
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
      const pickup = await this.flight(
        manager,
        input.pickupFlightId,
        src.businessUnit,
      );
      const drop = await this.flight(
        manager,
        input.dropFlightId,
        src.businessUnit,
      );
      const operator = await this.operator(
        manager,
        input.operatorId,
        src.businessUnit,
      );
      const s = this.schedule(
        src.startDate!,
        src.days,
        pickup.arrivalTime,
        drop.departureTime,
      );
      if (input.guideId)
        await this.lockGuide(
          manager,
          input.guideId,
          src.businessUnit,
          s.occupyFrom,
          s.occupyTo,
          null,
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
        src.businessUnit === 'shengxu' ? 'YNSS' : 'KMLX',
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
        `INSERT INTO tours (tour_no, source_module, business_unit, library, inquiry_id, quote_id, itinerary_id,
          inquiry_code, itinerary_code, quote_code, agency_name, contact_name, days, start_date, pickup_at, drop_at,
          occupy_from, occupy_to, country_item_id, country_code, country_name, creator_id, creator_tour_code,
          creator_sequence, collect_coordinator_id, collect_coordinator_name, operator_id, operator_name,
          adults, children, leaders, language, shopping, pickup_flight_id, drop_flight_id, pickup_flight, drop_flight,
          guide_id, remark, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,
          $29,$30,$31,$32,$33,$34,$35,$36::jsonb,$37::jsonb,$38,$39,$22,$22) RETURNING id`,
        [
          tourNo,
          src.module,
          src.businessUnit,
          libraryOf(src.businessUnit),
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
          pickup.id,
          drop.id,
          JSON.stringify(this.flightSnapshot(pickup)),
          JSON.stringify(this.flightSnapshot(drop)),
          input.guideId ?? null,
          input.remark,
        ],
      );
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
      'SELECT *, start_date::text AS start_date FROM tours WHERE id = $1 FOR UPDATE',
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
  private hasRatingValues(row: Row | undefined) {
    return !!row && RATING_FIELDS.some((f) => row[RATING_COLUMNS[f]] != null);
  }

  async update(
    id: string,
    input: UpdateTourDto,
    user: AuthenticatedUser,
  ): Promise<Row> {
    this.require(user, 'tour:update');
    await this.db.transaction(async (manager) => {
      const tour = await this.lockTour(manager, id, user);
      if (!this.canManage(user, tour)) forbidden();
      if (tour.status !== 'active') conflict('已撤销的旅行团不能修改');
      this.versionCheck(tour.version, input.version);
      const unit = tour.business_unit as Unit;
      const pickup =
        input.pickupFlightId === tour.pickup_flight_id
          ? null
          : await this.flight(manager, input.pickupFlightId, unit);
      const drop =
        input.dropFlightId === tour.drop_flight_id
          ? null
          : await this.flight(manager, input.dropFlightId, unit);
      const operator = await this.operator(manager, input.operatorId, unit);
      // Retained flight IDs retain their booked times and labels after master-data edits.
      const pickupSnapshot =
        input.pickupFlightId === tour.pickup_flight_id
          ? (tour.pickup_flight as ReturnType<ToursService['flightSnapshot']>)
          : this.flightSnapshot(pickup!);
      const dropSnapshot =
        input.dropFlightId === tour.drop_flight_id
          ? (tour.drop_flight as ReturnType<ToursService['flightSnapshot']>)
          : this.flightSnapshot(drop!);
      const startDate = tour.start_date as string;
      const s = this.schedule(
        startDate,
        tour.days as number,
        pickupSnapshot.arrivalTime,
        dropSnapshot.departureTime,
      );
      const newGuide = input.guideId ?? null;
      if (newGuide !== tour.guide_id) {
        const rating = await manager.query<Row[]>(
          'SELECT * FROM tour_ratings WHERE tour_id = $1',
          [id],
        );
        if (this.hasRatingValues(rating[0]))
          conflict('已录入评分，不能更换或清空导游');
      }
      if (newGuide)
        await this.lockGuide(
          manager,
          newGuide,
          unit,
          s.occupyFrom,
          s.occupyTo,
          id,
        );
      await manager.query(
        `UPDATE tours SET operator_id=$2, operator_name=$3, adults=$4, children=$5, leaders=$6, language=$7, shopping=$8,
          pickup_flight_id=$9, drop_flight_id=$10, pickup_flight=$11::jsonb, drop_flight=$12::jsonb,
          pickup_at=$13, drop_at=$14, occupy_from=$15, occupy_to=$16, guide_id=$17, remark=$18,
          version=version+1, updated_at=now(), updated_by=$19 WHERE id=$1`,
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
          input.pickupFlightId,
          input.dropFlightId,
          JSON.stringify(pickupSnapshot),
          JSON.stringify(dropSnapshot),
          s.pickupAt,
          s.dropAt,
          s.occupyFrom,
          s.occupyTo,
          newGuide,
          input.remark,
          user.id,
        ],
      );
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
      collectCoordinatorName: row.collectCoordinatorName,
      operatorName: row.operatorName,
      ...values,
      ...stats,
      version: (row.ratingVersion as number | null) ?? 0,
      canEdit:
        row.status === 'active' &&
        user.permissions.includes('tour:rating:update') &&
        (row.collectCoordinatorId === user.id ||
          row.operatorId === user.id ||
          (user.roles.includes('BUSINESS_MANAGER') &&
            user.scope === row.businessUnit)),
    };
  }

  private ratingSelect = `SELECT ${TOUR_SELECT}, ${RATING_SELECT}, r.version AS "ratingVersion"
    FROM ${TOUR_FROM} LEFT JOIN tour_ratings r ON r.tour_id = t.id`;

  async ratings(
    query: RatingQueryDto,
    user: AuthenticatedUser,
  ): Promise<PageResult<Row>> {
    this.require(user, 'tour:list');
    const params: unknown[] = [];
    let where = `WHERE t.guide_id IS NOT NULL${this.visible(user, params)}`;
    if (query.guideId)
      where += ` AND t.guide_id = $${params.push(query.guideId)}`;
    const keyword = query.keyword?.trim();
    if (keyword) {
      const p = `$${params.push(`%${keyword}%`)}`;
      where += ` AND (t.tour_no ILIKE ${p} OR g.name ILIKE ${p})`;
    }
    const total = await this.db.query<{ count: string }[]>(
      `SELECT count(*) FROM ${TOUR_FROM} ${where}`,
      params,
    );
    const rows = await this.db.query<Row[]>(
      `${this.ratingSelect} ${where} ORDER BY t.start_date DESC, t.created_at DESC, t.id
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
      if (!own && !manages) forbidden();
      if (tour.status !== 'active') conflict('已撤销的旅行团不能修改评分');
      if (!tour.guide_id) conflict('未分配导游的团不能评分');
      const existing = (
        await manager.query<Row[]>(
          'SELECT * FROM tour_ratings WHERE tour_id = $1',
          [id],
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
           version = version + 1, updated_at = now(), updated_by = $${RATING_FIELDS.length + 3} WHERE tour_id = $1`,
          [id, tour.guide_id, ...values, user.id],
        );
      } else {
        await manager.query(
          `INSERT INTO tour_ratings (tour_id, guide_id, ${RATING_FIELDS.map((f) => RATING_COLUMNS[f]).join(', ')}, created_by, updated_by)
           VALUES ($1, $2, ${RATING_FIELDS.map((_f, i) => `$${i + 3}`).join(', ')}, $${RATING_FIELDS.length + 3}, $${RATING_FIELDS.length + 3})`,
          [id, tour.guide_id, ...values, user.id],
        );
      }
    });
    const params: unknown[] = [id];
    const rows = await this.db.query<Row[]>(
      `${this.ratingSelect} WHERE t.id = $1${this.visible(user, params)}`,
      params,
    );
    return rows[0] ? this.ratingRow(rows[0], user) : notFound();
  }
}

export type { TourInputDto };
