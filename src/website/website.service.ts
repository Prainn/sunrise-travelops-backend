import type { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { pickTourNumber, tourNumberBase } from '../tours/tour-rules';
import { HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import type { AuthenticatedUser } from '../auth/auth.types';
import { BusinessException } from '../common/exceptions/business.exception';
import type { ErrorCodeValue } from '../common/constants/error-code';
import { assertNoActiveTour } from '../common/tour-lock';
import { requireDictionaryItem } from '../common/dictionary-items';
import { nextBusinessCode } from '../common/business-code';
import { UserEntity, UserStatus } from '../users/user.entity';
import type {
  WebsiteBusinessUnit,
  WebsiteConfig,
  WebsiteInquiry,
  WebsiteInquiryInput,
  WebsiteDay,
  WebsiteItinerary,
  WebsiteItineraryInput,
  WebsiteInquiryLog,
  WebsiteLogAction,
  WebsiteLogMetadata,
  WebsiteQuotation,
  WebsiteValidation,
} from './website.types';
import type {
  WebsiteConfirmDto,
  WebsiteCreateItineraryDto,
  WebsiteInquiryQuery,
  WebsiteLogQuery,
  WebsiteResourceQuery,
  WebsiteTransferDto,
  WebsiteUpdateInquiryDto,
  WebsiteUpdateItineraryDto,
} from './website.dto';
import {
  buildWebsitePreview,
  generateWebsiteDraft,
  validateWebsiteConfig,
} from './website-engine';
import { loadWebsiteDetails, saveWebsiteDetails } from './website.persistence';
import { WEBSITE_LOG_ACTIONS } from './website.types';
import { websiteLogChanges } from './website-log-changes';

type ResourceKind =
  'city' | 'attraction' | 'hotel' | 'restaurant' | 'transport';
interface ResourceReference {
  key: string;
  kind: ResourceKind;
  id: string;
}
export interface ResourceOption {
  id: string;
  name: string;
  city?: string;
  seats?: number;
}
export interface ResourceDetail extends Omit<ResourceOption, 'city'> {
  city?: string | null;
  status: 'enabled' | 'disabled';
}
export interface OwnerOption {
  id: string;
  name: string;
  username: string;
}
type ItineraryRow = Omit<WebsiteItinerary, 'days' | 'vehiclePrices'>;
const resourceTables: Record<ResourceKind, string> = {
  city: 'resource_cities',
  attraction: 'resource_attractions',
  hotel: 'resource_hotels',
  restaurant: 'resource_restaurants',
  transport: 'resource_transports',
};
const inquiryColumns = `i.id,i.code,i.business_unit AS "businessUnit",i.customer_name AS "customerName",i.planned_days AS "plannedDays",
  EXISTS(SELECT 1 FROM tours t WHERE t.source_module='website' AND t.inquiry_id=i.id AND t.status='active') AS "hasActiveTour",
  i.country_item_id AS "countryItemId",i.country_code AS "countryCode",i.country_or_region AS "countryOrRegion",
  i.requirements,i.owner_id AS "ownerId",i.owner,i.contact_info AS "contactInfo",
  to_char(i.received_at,'YYYY-MM-DD HH24:MI') AS "receivedAt",i.contact_channel AS "contactChannel",
  i.whatsapp_source_id AS "whatsappSourceId",i.website_inquiry_no AS "websiteInquiryNo",
  i.landing_page AS "landingPage",i.acquisition_source AS "acquisitionSource",
  i.start_date::text AS "startDate",i.pax,i.destinations,
  i.internal_remark AS "internalRemark",i.lost_reason AS "lostReason",i.status,i.version,
  to_char(i.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",
  to_char(i.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt"`;
const itineraryColumns = `id,business_unit AS "businessUnit",inquiry_id AS "inquiryId",code,title,duration,start_date::text AS "startDate",pax,
  arrival_time AS "arrivalTime",departure_time AS "departureTime",config_version AS "configVersion",reorder_draft AS "reorderDraft",status,version,
  to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",
  to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt"`;
function fail(
  code: ErrorCodeValue,
  message: string,
  status: HttpStatus,
  details?: Record<string, unknown>,
): never {
  throw new BusinessException({ code, message, status, details });
}
function invalid(message: string, details?: Record<string, unknown>): never {
  return fail('ITINERARY_INVALID', message, HttpStatus.BAD_REQUEST, details);
}
function duplicate(values: string[]): boolean {
  return new Set(values).size !== values.length;
}

@Injectable()
export class WebsiteService {
  constructor(private readonly db: DataSource) {}

  private hasPermission(user: AuthenticatedUser, permission: string) {
    return (
      ['linxi', 'website', 'headquarters'].includes(user.scope) &&
      user.permissions.includes(permission)
    );
  }
  canListInquiries(user: AuthenticatedUser) {
    return this.hasPermission(user, 'website:inquiry:list');
  }
  private permission(user: AuthenticatedUser, permission: string) {
    if (!this.hasPermission(user, permission))
      fail('AUTH_FORBIDDEN', '无独立站访问权限', HttpStatus.FORBIDDEN);
  }
  private businessUnit(
    user: AuthenticatedUser,
    requested?: WebsiteBusinessUnit,
  ): WebsiteBusinessUnit {
    if (user.scope === 'headquarters') {
      if (!requested)
        fail('VALIDATION_ERROR', '请选择所属业务部', HttpStatus.BAD_REQUEST);
      return requested;
    }
    if (
      !['linxi', 'website'].includes(user.scope) ||
      (requested && requested !== user.scope)
    )
      fail('AUTH_FORBIDDEN', '不能访问其他业务', HttpStatus.FORBIDDEN);
    return user.scope as WebsiteBusinessUnit;
  }
  private allInquiries(user: AuthenticatedUser) {
    return (
      user.scope === 'headquarters' || user.roles.includes('BUSINESS_MANAGER')
    );
  }
  private async mutable(inquiry: WebsiteInquiry, manager: EntityManager) {
    if (['lost', 'archived'].includes(inquiry.status))
      fail('INQUIRY_READ_ONLY', '已结束询盘只读', HttpStatus.CONFLICT);
    await assertNoActiveTour(manager, 'website', inquiry.id);
  }
  private draft(itinerary: WebsiteItinerary) {
    if (itinerary.status !== 'draft')
      fail(
        'ITINERARY_READ_ONLY',
        '已确认报价的行程只能复制后修改',
        HttpStatus.CONFLICT,
      );
  }
  private version(current: number, expected: number, itinerary = false) {
    if (current !== expected)
      fail(
        itinerary ? 'ITINERARY_VERSION_CONFLICT' : 'INQUIRY_VERSION_CONFLICT',
        '记录已更新，请重新加载',
        HttpStatus.CONFLICT,
        { currentVersion: current },
      );
  }
  private async inquiry(
    id: string,
    user: AuthenticatedUser,
    manager = this.db.manager,
    lock = false,
  ): Promise<WebsiteInquiry> {
    this.permission(user, 'website:inquiry:list');
    const params: unknown[] = [id];
    let scope =
      user.scope === 'headquarters'
        ? ''
        : ` AND i.business_unit=$${params.push(this.businessUnit(user))}`;
    if (!this.allInquiries(user))
      scope += ` AND i.owner_id=$${params.push(user.id)}`;
    const rows = await manager.query<WebsiteInquiry[]>(
      `SELECT ${inquiryColumns} FROM website_inquiries i
      WHERE i.id=$1${scope}${lock ? ' FOR UPDATE OF i' : ''}`,
      params,
    );
    if (!rows[0])
      fail('INQUIRY_NOT_FOUND', '独立站询盘不存在', HttpStatus.NOT_FOUND);
    return rows[0];
  }
  private async itinerary(
    id: string,
    user: AuthenticatedUser,
    manager = this.db.manager,
    lock = false,
  ) {
    this.permission(user, 'website:itinerary:list');
    const initial = await manager.query<{ inquiryId: string }[]>(
      'SELECT inquiry_id AS "inquiryId" FROM website_itineraries WHERE id=$1',
      [id],
    );
    if (!initial[0])
      fail('ITINERARY_NOT_FOUND', '独立站行程不存在', HttpStatus.NOT_FOUND);
    // Every writer locks inquiry before itinerary, including confirmation and copy.
    const inquiry = await this.inquiry(
      initial[0].inquiryId,
      user,
      manager,
      lock,
    );
    const rows = await manager.query<ItineraryRow[]>(
      `SELECT ${itineraryColumns} FROM website_itineraries WHERE id=$1${lock ? ' FOR UPDATE' : ''}`,
      [id],
    );
    if (!rows[0])
      fail('ITINERARY_NOT_FOUND', '独立站行程不存在', HttpStatus.NOT_FOUND);
    const itinerary: WebsiteItinerary = {
      ...rows[0],
      ...(await loadWebsiteDetails(manager, id)),
    };
    return { inquiry, itinerary };
  }
  private async config(
    manager: EntityManager,
    businessUnit: WebsiteBusinessUnit,
    version?: number,
  ): Promise<WebsiteConfig> {
    const rows = await manager.query<{ config: WebsiteConfig }[]>(
      version === undefined
        ? 'SELECT v.config FROM website_config_versions v JOIN website_config_current c ON c.version=v.version WHERE c.business_unit=$1'
        : 'SELECT config FROM website_config_versions WHERE business_unit=$1 AND version=$2',
      version === undefined ? [businessUnit] : [businessUnit, version],
    );
    if (!rows[0])
      fail('NOT_FOUND', '独立站配置版本不存在', HttpStatus.NOT_FOUND, {
        configVersion: version,
      });
    return rows[0].config;
  }
  async getConfig(
    user: AuthenticatedUser,
    version?: number,
    businessUnit?: WebsiteBusinessUnit,
  ) {
    this.permission(user, 'website:config:list');
    return this.config(
      this.db.manager,
      this.businessUnit(user, businessUnit),
      version,
    );
  }
  private configReferences(config: WebsiteConfig): ResourceReference[] {
    return [
      ...config.cities.flatMap((c) =>
        c.resourceId
          ? [
              {
                key: `city:${c.id}:${c.resourceId}`,
                kind: 'city' as const,
                id: c.resourceId,
              },
            ]
          : [],
      ),
      ...config.hotels.flatMap((h) =>
        h.resourceId
          ? [
              {
                key: `hotel:${h.id}:${h.resourceId}`,
                kind: 'hotel' as const,
                id: h.resourceId,
              },
            ]
          : [],
      ),
      ...config.attractions.flatMap((a) =>
        a.resourceId
          ? [
              {
                key: `attraction:${a.id}:${a.resourceId}`,
                kind: 'attraction' as const,
                id: a.resourceId,
              },
            ]
          : [],
      ),
    ];
  }
  private planReferences(
    input: WebsiteItineraryInput,
    config: WebsiteConfig,
  ): ResourceReference[] {
    const cityIds = new Set(
      input.days.flatMap((d) => [
        d.departCityId,
        d.endCityId,
        ...(d.overnightCityId ? [d.overnightCityId] : []),
        ...d.hotels.map((h) => h.cityId),
        ...d.legs.flatMap((l) => [l.fromCityId, l.toCityId]),
      ]),
    );
    const attractionIds = new Set(
      input.days.flatMap((d) =>
        d.items.flatMap((i) => (i.attractionId ? [i.attractionId] : [])),
      ),
    );
    const refs = this.configReferences({
      ...config,
      cities: config.cities.filter((city) => cityIds.has(city.id)),
      attractions: config.attractions.filter((attraction) =>
        attractionIds.has(attraction.id),
      ),
      hotels: [],
    });
    return [
      ...refs,
      ...input.days.flatMap((d) => [
        ...d.hotels.flatMap((h) =>
          h.resourceId
            ? [
                {
                  key: `hotel:${h.id}:${h.resourceId}`,
                  kind: 'hotel' as const,
                  id: h.resourceId,
                },
              ]
            : [],
        ),
        ...d.meals.flatMap((m) =>
          m.resourceId
            ? [
                {
                  key: `restaurant:${m.id}:${m.resourceId}`,
                  kind: 'restaurant' as const,
                  id: m.resourceId,
                },
              ]
            : [],
        ),
      ]),
    ];
  }
  private async resourceIssues(
    manager: EntityManager,
    refs: ResourceReference[],
    oldRefs?: ResourceReference[],
  ) {
    const retained = new Set(oldRefs?.map((r) => r.key));
    const issues: WebsiteValidation[] = [];
    for (const kind of Object.keys(resourceTables) as ResourceKind[]) {
      const selected = refs.filter((r) => r.kind === kind);
      if (!selected.length) continue;
      const rows = await manager.query<
        { id: string; status: string; deleted: boolean }[]
      >(
        `SELECT id,status,deleted_at IS NOT NULL AS deleted FROM ${resourceTables[kind]} WHERE id=ANY($1::uuid[])${manager.queryRunner?.isTransactionActive ? ' FOR SHARE' : ''}`,
        [[...new Set(selected.map((r) => r.id))]],
      );
      for (const ref of selected) {
        const row = rows.find((r) => r.id === ref.id);
        if (
          !row ||
          row.deleted ||
          (oldRefs !== undefined &&
            !retained.has(ref.key) &&
            row.status !== 'enabled')
        )
          issues.push({
            code: 'RESOURCE_INVALID',
            severity: 'ERROR',
            message: `${kind}资源不可用：${ref.id}`,
          });
      }
    }
    return issues;
  }
  async saveConfig(
    input: WebsiteConfig,
    user: AuthenticatedUser,
    requested?: WebsiteBusinessUnit,
  ) {
    this.permission(user, 'website:config:update');
    const businessUnit = this.businessUnit(user, requested);
    validateWebsiteConfig(input);
    return this.db.transaction(async (manager) => {
      await manager.query(
        'SELECT id FROM website_config_current WHERE business_unit=$1 FOR UPDATE',
        [businessUnit],
      );
      const old = await this.config(manager, businessUnit);
      if (old.version !== input.version)
        fail('CONFLICT', '配置已更新，请重新加载', HttpStatus.CONFLICT, {
          currentVersion: old.version,
        });
      const issues = await this.resourceIssues(
        manager,
        this.configReferences(input),
        this.configReferences(old),
      );
      if (issues.length) invalid('配置引用的基础资源不可用', { issues });
      const [next] = await manager.query<Array<{ version: number }>>(
        "SELECT nextval('website_config_version_seq')::integer AS version",
      );
      const saved: WebsiteConfig = { ...input, version: next.version };
      await manager.query(
        'INSERT INTO website_config_versions(version,config,created_by,business_unit) VALUES($1,$2::jsonb,$3,$4)',
        [saved.version, JSON.stringify(saved), user.id, businessUnit],
      );
      await manager.query(
        'UPDATE website_config_current SET version=$1 WHERE business_unit=$2',
        [saved.version, businessUnit],
      );
      return saved;
    });
  }
  private async owner(
    manager: EntityManager,
    id: string,
    businessUnit: WebsiteBusinessUnit,
  ): Promise<OwnerOption> {
    const user = await manager
      .createQueryBuilder(UserEntity, 'u')
      .where('u.id=:id', { id })
      .setLock('pessimistic_write')
      .getOne();
    const eligible = await manager.query<{ id: string }[]>(
      `SELECT i.id FROM user_identities i
      JOIN identity_roles ir ON ir.identity_id=i.id JOIN roles r ON r.id=ir.role_id
      WHERE i.user_id=$1 AND i.scope=$2 AND r.code='COORDINATOR' AND r.is_enabled=true`,
      [id, businessUnit],
    );
    if (
      !user ||
      user.status !== UserStatus.Enabled ||
      user.deletedAt ||
      !eligible.length
    )
      fail(
        'INQUIRY_OWNER_INVALID',
        '负责人必须是启用的独立站计调',
        HttpStatus.BAD_REQUEST,
      );
    return { id: user.id, name: user.nickname, username: user.username };
  }
  async owners(
    user: AuthenticatedUser,
    requested?: WebsiteBusinessUnit,
  ): Promise<OwnerOption[]> {
    this.permission(user, 'website:inquiry:list');
    const businessUnit = this.businessUnit(user, requested);
    const scope = this.allInquiries(user) ? '' : ' AND u.id=$2';
    return this.db.manager.query<OwnerOption[]>(
      `SELECT DISTINCT u.id,u.nickname AS name,u.username FROM users u
      JOIN user_identities i ON i.user_id=u.id JOIN identity_roles ir ON ir.identity_id=i.id JOIN roles r ON r.id=ir.role_id
      WHERE u.deleted_at IS NULL AND u.status='enabled' AND i.scope=$1
      AND r.code='COORDINATOR' AND r.is_enabled=true${scope} ORDER BY name,id`,
      scope ? [businessUnit, user.id] : [businessUnit],
    );
  }
  private inquiryScope(
    user: AuthenticatedUser,
    params: unknown[],
    businessUnit?: WebsiteBusinessUnit,
  ) {
    this.permission(user, 'website:inquiry:list');
    const clauses: string[] = [];
    if (user.scope !== 'headquarters' || businessUnit)
      clauses.push(
        `i.business_unit=$${params.push(this.businessUnit(user, businessUnit))}`,
      );
    if (!this.allInquiries(user))
      clauses.push(`i.owner_id=$${params.push(user.id)}`);
    return clauses;
  }
  async countByStatus(user: AuthenticatedUser) {
    const params: unknown[] = [];
    const clauses = this.inquiryScope(user, params);
    clauses.push("i.status IN ('new','planning','quoted')");
    return this.db.manager.query<{ status: string; count: string }[]>(
      `SELECT i.status, COUNT(*) AS count FROM website_inquiries i
       WHERE ${clauses.join(' AND ')} GROUP BY i.status`,
      params,
    );
  }
  async countCreatedByDate(
    from: string,
    until: string,
    user: AuthenticatedUser,
  ) {
    const params: unknown[] = [];
    const clauses = this.inquiryScope(user, params);
    clauses.push(
      `i.created_at >= $${params.push(`${from}T00:00:00+08:00`)}::timestamptz`,
      `i.created_at < $${params.push(`${until}T00:00:00+08:00`)}::timestamptz`,
    );
    return this.db.manager.query<{ date: string; count: string }[]>(
      `SELECT to_char(i.created_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD') AS date,
       COUNT(*) AS count FROM website_inquiries i WHERE ${clauses.join(' AND ')} GROUP BY 1`,
      params,
    );
  }
  async list(query: WebsiteInquiryQuery, user: AuthenticatedUser) {
    const params: unknown[] = [];
    const clauses = this.inquiryScope(user, params, query.businessUnit);
    if (query.ownerId)
      clauses.push(`i.owner_id=$${params.push(query.ownerId)}`);
    if (query.status) clauses.push(`i.status=$${params.push(query.status)}`);
    if (query.keyword) {
      const p = params.push(`%${query.keyword}%`);
      clauses.push(
        `(i.code ILIKE $${p} OR i.customer_name ILIKE $${p} OR i.requirements ILIKE $${p})`,
      );
    }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const count = await this.db.manager.query<{ total: string }[]>(
      `SELECT count(*)::text AS total FROM website_inquiries i${where}`,
      params,
    );
    const paging = [
      ...params,
      query.pageSize,
      (query.page - 1) * query.pageSize,
    ];
    const list = await this.db.manager.query<WebsiteInquiry[]>(
      `SELECT ${inquiryColumns} FROM website_inquiries i${where}
      ORDER BY i.created_at DESC,i.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      paging,
    );
    return {
      list,
      total: Number(count[0].total),
      page: query.page,
      pageSize: query.pageSize,
    };
  }
  detail(id: string, user: AuthenticatedUser) {
    return this.inquiry(id, user);
  }
  private async inquiryDestinations(
    manager: EntityManager,
    input: WebsiteInquiryInput,
    businessUnit: WebsiteBusinessUnit,
    old?: WebsiteInquiry,
  ) {
    if (!input.destinations.length) return;
    const config = await this.config(manager, businessUnit);
    for (const id of input.destinations) {
      const city = config.cities.find((c) => c.id === id);
      if (
        !city ||
        (city.status !== 'enabled' && !old?.destinations.includes(id))
      )
        invalid('询盘目的地不是可用的独立站配置城市', { cityId: id });
    }
  }
  private async log(
    manager: EntityManager,
    inquiry: WebsiteInquiry,
    action: WebsiteLogAction,
    user: AuthenticatedUser,
    before: WebsiteInquiry | WebsiteItinerary | undefined,
    after: WebsiteInquiry | WebsiteItinerary,
    options: { detail?: string; metadata?: WebsiteLogMetadata } = {},
  ) {
    const changes = websiteLogChanges(before, after);
    if (before && changes.length === 0) return;
    const isItinerary = 'inquiryId' in after;
    await manager.query(
      `INSERT INTO website_logs(id,inquiry_id,action,target_id,actor_id,actor_name,detail,
        inquiry_code,operator_username,target_type,target_code,summary,changes,metadata)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb)`,
      [
        randomUUID(),
        inquiry.id,
        action,
        after.id,
        user.id,
        user.nickname,
        options.detail ?? '',
        inquiry.code,
        user.username,
        isItinerary ? 'itinerary' : 'inquiry',
        after.code,
        isItinerary ? after.title : null,
        JSON.stringify(changes),
        JSON.stringify(options.metadata ?? {}),
      ],
    );
  }
  async create(
    input: WebsiteInquiryInput,
    user: AuthenticatedUser,
    transactionManager?: EntityManager,
  ) {
    this.permission(user, 'website:inquiry:create');
    const businessUnit = this.businessUnit(user, input.businessUnit);
    if (input.status && input.status !== 'new') invalid('新询盘状态必须为new');
    const create = async (manager: EntityManager) => {
      let ownerId = input.ownerId;
      const managerRole =
        user.scope === 'headquarters' ||
        user.roles.includes('BUSINESS_MANAGER');
      if (!managerRole) {
        if (ownerId && ownerId !== user.id)
          fail(
            'AUTH_FORBIDDEN',
            '计调不能指定其他负责人',
            HttpStatus.FORBIDDEN,
          );
        ownerId = user.id;
      }
      if (!ownerId)
        fail(
          'INQUIRY_OWNER_INVALID',
          '请选择独立站计调负责人',
          HttpStatus.BAD_REQUEST,
        );
      const owner = await this.owner(manager, ownerId, businessUnit);
      await this.inquiryDestinations(manager, input, businessUnit);
      const country = await requireDictionaryItem(
        manager,
        'country-region',
        input.countryItemId,
      );
      const [creator] = await manager.query<{ tourCode: string | null }[]>(
        'SELECT tour_code AS "tourCode" FROM users WHERE id=$1 FOR SHARE',
        [user.id],
      );
      if (!creator?.tourCode)
        fail(
          'VALIDATION_ERROR',
          '当前账号未设置团号标识',
          HttpStatus.BAD_REQUEST,
        );
      const [day] = await manager.query<{ date: string }[]>(
        `SELECT (now() AT TIME ZONE 'Asia/Shanghai')::date::text AS date`,
      );
      // Reserve the rendered code independently of the business row: deletion
      // cannot reuse it. One daily lock also covers ambiguous digit-ending markers.
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `website-inquiry-number:${day.date}`,
      ]);
      const [counter] = await manager.query<{ next: number }[]>(
        `SELECT (coalesce(max(sequence),0)+1)::integer AS next
         FROM website_inquiry_numbers WHERE creator_code=$1 AND creation_date=$2`,
        [creator.tourCode, day.date],
      );
      const base = tourNumberBase(
        businessUnit === 'website' ? 'LYNX-INQ' : 'KMLX-WIQ',
        day.date,
        creator.tourCode,
        country.code,
      );
      const taken = await manager.query<{ code: string }[]>(
        'SELECT code FROM website_inquiry_numbers WHERE creation_date=$1',
        [day.date],
      );
      const code = pickTourNumber(
        base,
        counter.next,
        new Set(taken.map((row) => row.code)),
      );
      await manager.query(
        `INSERT INTO website_inquiry_numbers(code,creator_code,creation_date,sequence) VALUES($1,$2,$3,$4)`,
        [code, creator.tourCode, day.date, counter.next],
      );
      const id = randomUUID();
      await manager.query(
        `INSERT INTO website_inquiries(id,code,customer_name,planned_days,requirements,owner_id,owner,
        contact_info,start_date,pax,destinations,internal_remark,lost_reason,status,
        country_item_id,country_code,country_or_region,business_unit,
        received_at,contact_channel,whatsapp_source_id,website_inquiry_no,landing_page,acquisition_source)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'','new',$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
        [
          id,
          code,
          input.customerName,
          input.plannedDays,
          input.requirements,
          owner.id,
          owner.name,
          input.contactInfo,
          input.startDate,
          input.pax,
          input.destinations,
          input.internalRemark,
          country.id,
          country.code,
          country.name,
          businessUnit,
          input.receivedAt,
          input.contactChannel,
          input.whatsappSourceId,
          input.websiteInquiryNo,
          input.landingPage,
          input.acquisitionSource,
        ],
      );
      const created = await this.inquiry(id, user, manager);
      await this.log(
        manager,
        created,
        'inquiry_created',
        user,
        undefined,
        created,
      );
      return created;
    };
    return transactionManager
      ? create(transactionManager)
      : this.db.transaction(create);
  }
  async update(
    id: string,
    input: WebsiteUpdateInquiryDto,
    user: AuthenticatedUser,
  ) {
    this.permission(user, 'website:inquiry:update');
    return this.db.transaction(async (manager) => {
      const old = await this.inquiry(id, user, manager, true);
      await this.mutable(old, manager);
      this.version(old.version, input.version);
      if (input.ownerId && input.ownerId !== old.ownerId)
        invalid('负责人变更请使用转交操作');
      const status = input.status ?? old.status;
      if (status !== old.status && status !== 'lost')
        invalid('状态由行程和报价流程推进；结束请使用流失或归档操作');
      if (status === 'lost' && !input.lostReason.trim())
        invalid('请填写流失原因');
      await this.inquiryDestinations(manager, input, old.businessUnit, old);
      const country =
        old.countryItemId === input.countryItemId
          ? {
              id: old.countryItemId,
              code: old.countryCode,
              name: old.countryOrRegion,
            }
          : await requireDictionaryItem(
              manager,
              'country-region',
              input.countryItemId,
            );
      await manager.query(
        `UPDATE website_inquiries SET country_item_id=$12,country_code=$13,country_or_region=$14,customer_name=$2,planned_days=$3,requirements=$4,contact_info=$5,
        start_date=$6,pax=$7,destinations=$8,internal_remark=$9,lost_reason=$10,status=$11,
        received_at=$15,contact_channel=$16,whatsapp_source_id=$17,website_inquiry_no=$18,
        landing_page=$19,acquisition_source=$20,version=version+1,updated_at=now() WHERE id=$1`,
        [
          id,
          input.customerName,
          input.plannedDays,
          input.requirements,
          input.contactInfo,
          input.startDate,
          input.pax,
          input.destinations,
          input.internalRemark,
          input.lostReason,
          status,
          country.id,
          country.code,
          country.name,
          input.receivedAt,
          input.contactChannel,
          input.whatsappSourceId,
          input.websiteInquiryNo,
          input.landingPage,
          input.acquisitionSource,
        ],
      );
      const updated = await this.inquiry(id, user, manager);
      await this.log(
        manager,
        updated,
        status === 'lost' ? 'inquiry_lost' : 'inquiry_updated',
        user,
        old,
        updated,
        status === 'lost'
          ? {
              detail: input.lostReason,
              metadata: { lostReason: input.lostReason },
            }
          : {},
      );
      return updated;
    });
  }
  async transfer(
    id: string,
    input: WebsiteTransferDto,
    user: AuthenticatedUser,
  ) {
    this.permission(user, 'website:inquiry:transfer');
    return this.db.transaction(async (manager) => {
      // Account updates also lock users before checking outstanding inquiries.
      const source = await this.inquiry(id, user, manager);
      const owner = await this.owner(
        manager,
        input.ownerId,
        source.businessUnit,
      );
      const old = await this.inquiry(id, user, manager, true);
      await this.mutable(old, manager);
      this.version(old.version, input.version);
      if (old.ownerId === owner.id) invalid('新负责人不能与当前负责人相同');
      await manager.query(
        'UPDATE website_inquiries SET owner_id=$2,owner=$3,version=version+1,updated_at=now() WHERE id=$1',
        [id, owner.id, owner.name],
      );
      const updated = await this.inquiry(id, user, manager);
      await this.log(
        manager,
        updated,
        'inquiry_transferred',
        user,
        old,
        updated,
        {
          detail: `${old.owner} → ${owner.name}：${input.reason}`,
          metadata: { transferReason: input.reason },
        },
      );
      return updated;
    });
  }
  async archive(id: string, version: number, user: AuthenticatedUser) {
    this.permission(user, 'website:inquiry:archive');
    return this.db.transaction(async (manager) => {
      const inquiry = await this.inquiry(id, user, manager, true);
      this.version(inquiry.version, version);
      if (inquiry.status === 'archived') return inquiry;
      await this.mutable(inquiry, manager);
      await manager.query(
        "UPDATE website_inquiries SET status='archived',version=version+1,updated_at=now() WHERE id=$1",
        [id],
      );
      const updated = await this.inquiry(id, user, manager);
      await this.log(
        manager,
        updated,
        'inquiry_archived',
        user,
        inquiry,
        updated,
      );
      return updated;
    });
  }
  private async logFilter(query: WebsiteLogQuery, user: AuthenticatedUser) {
    const params: unknown[] = [];
    const clauses = this.inquiryScope(user, params, query.businessUnit);
    if (query.from && query.to && query.from > query.to)
      fail(
        'VALIDATION_ERROR',
        '开始日期不能晚于结束日期',
        HttpStatus.BAD_REQUEST,
      );
    const bind = (value: unknown) => `$${params.push(value)}`;
    if (query.inquiryId) {
      await this.inquiry(query.inquiryId, user);
      clauses.push(`i.id=${bind(query.inquiryId)}`);
    }
    if (query.inquiryCode?.trim()) {
      const pattern = query.inquiryCode.trim().replace(/[\\%_]/g, '\\$&');
      clauses.push(`i.code ILIKE ${bind(`%${pattern}%`)} ESCAPE E'\\\\'`);
    }
    if (query.operatorId) clauses.push(`l.actor_id=${bind(query.operatorId)}`);
    if (query.action) clauses.push(`l.action=${bind(query.action)}`);
    if (query.from)
      clauses.push(
        `l.occurred_at>=${bind(`${query.from}T00:00:00+08:00`)}::timestamptz`,
      );
    if (query.to)
      clauses.push(
        `l.occurred_at<(${bind(query.to)}::date + 1)::timestamp AT TIME ZONE 'Asia/Shanghai'`,
      );
    return {
      params,
      where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    };
  }

  async inquiryLogs(query: WebsiteLogQuery, user: AuthenticatedUser) {
    const { where, params } = await this.logFilter(query, user);
    const [count] = await this.db.manager.query<{ total: string }[]>(
      `SELECT count(*)::text AS total FROM website_logs l
       JOIN website_inquiries i ON i.id=l.inquiry_id ${where}`,
      params,
    );
    const list = await this.db.manager.query<WebsiteInquiryLog[]>(
      `SELECT l.id,l.inquiry_id AS "inquiryId",COALESCE(l.inquiry_code,i.code) AS "inquiryCode",
        i.business_unit AS "businessUnit",l.action,
        to_char(l.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "occurredAt",
        l.actor_id AS "operatorId",l.actor_name AS "operatorName",l.operator_username AS "operatorUsername",
        COALESCE(l.target_type,CASE WHEN l.target_id=i.id THEN 'inquiry' ELSE 'itinerary' END) AS "targetType",
        l.target_id AS "targetId",COALESCE(l.target_code,CASE WHEN l.target_id=i.id THEN i.code ELSE t.code END) AS "targetCode",
        CASE WHEN l.changes IS NULL THEN t.title ELSE l.summary END AS summary,l.detail,l.metadata,l.changes
       FROM website_logs l JOIN website_inquiries i ON i.id=l.inquiry_id
       LEFT JOIN website_itineraries t ON t.id=l.target_id AND t.inquiry_id=i.id
       ${where} ORDER BY l.occurred_at DESC,l.id DESC
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

  async inquiryLogReport(query: WebsiteLogQuery, user: AuthenticatedUser) {
    const { where, params } = await this.logFilter(query, user);
    // One statement keeps aggregate totals and per-action counts on the same snapshot.
    const [totals] = await this.db.manager.query<
      {
        totalOperations: string;
        inquiryCount: string;
        operatorCount: string;
        changedFields: string;
        logsWithoutChanges: string;
        byAction: { action: string; count: number }[];
      }[]
    >(
      `WITH filtered AS (
        SELECT l.* FROM website_logs l JOIN website_inquiries i ON i.id=l.inquiry_id ${where}
      ) SELECT count(*)::text AS "totalOperations",count(DISTINCT inquiry_id)::text AS "inquiryCount",
        count(DISTINCT actor_id)::text AS "operatorCount",
        COALESCE(sum(jsonb_array_length(changes)),0)::text AS "changedFields",
        count(*) FILTER(WHERE changes IS NULL)::text AS "logsWithoutChanges",
        COALESCE((SELECT jsonb_agg(jsonb_build_object('action',action,'count',count) ORDER BY action)
          FROM (SELECT action,count(*) AS count FROM filtered GROUP BY action) counts),'[]'::jsonb) AS "byAction"
        FROM filtered`,
      params,
    );
    const counts = new Map(
      totals.byAction.map((item) => [item.action, item.count]),
    );
    const actions: string[] = [...WEBSITE_LOG_ACTIONS];
    for (const action of counts.keys())
      if (!actions.includes(action)) actions.push(action);
    return {
      totalOperations: Number(totals.totalOperations),
      inquiryCount: Number(totals.inquiryCount),
      operatorCount: Number(totals.operatorCount),
      changedFields: Number(totals.changedFields),
      logsWithoutChanges: Number(totals.logsWithoutChanges),
      byAction: actions.map((action) => ({
        action,
        count: Number(counts.get(action) ?? 0),
      })),
    };
  }

  async inquiryLogOperators(query: WebsiteLogQuery, user: AuthenticatedUser) {
    const { where, params } = await this.logFilter(query, user);
    return this.db.manager.query<
      { id: string; name: string; username: string | null }[]
    >(
      `SELECT DISTINCT ON(l.actor_id) l.actor_id AS id,l.actor_name AS name,l.operator_username AS username
       FROM website_logs l JOIN website_inquiries i ON i.id=l.inquiry_id ${where}
       ORDER BY l.actor_id,l.occurred_at DESC,l.id DESC`,
      params,
    );
  }

  async itineraries(inquiryId: string, user: AuthenticatedUser) {
    this.permission(user, 'website:itinerary:list');
    await this.inquiry(inquiryId, user);
    const rows = await this.db.manager.query<ItineraryRow[]>(
      `SELECT ${itineraryColumns} FROM website_itineraries WHERE inquiry_id=$1 ORDER BY created_at DESC,id DESC`,
      [inquiryId],
    );
    return Promise.all(
      rows.map(async (row) => ({
        ...row,
        ...(await loadWebsiteDetails(this.db.manager, row.id)),
      })),
    );
  }
  async itineraryDetail(id: string, user: AuthenticatedUser) {
    return (await this.itinerary(id, user)).itinerary;
  }
  private async preparePlan(
    manager: EntityManager,
    input: WebsiteItineraryInput,
    businessUnit: WebsiteBusinessUnit,
    old?: WebsiteItinerary,
    validate = false,
  ): Promise<WebsiteItineraryInput> {
    const config = await this.config(
      manager,
      businessUnit,
      input.configVersion,
    );
    const oldConfig = old
      ? await this.config(manager, businessUnit, old.configVersion)
      : config;
    const allDays = [
      ...input.days,
      ...(input.deletedDays ?? []).map((entry) => entry.day),
    ];
    if (old)
      old = {
        ...old,
        days: [
          ...old.days,
          ...(old.deletedDays ?? []).map((entry) => entry.day),
        ],
      };
    const ids = allDays.flatMap((d) => [
      d.id,
      ...d.items.map((i) => i.id),
      ...d.legs.map((l) => l.id),
      ...d.hotels.map((h) => h.id),
      ...d.meals.map((m) => m.id),
      ...d.services.map((s) => s.id),
    ]);
    if (
      duplicate(ids) ||
      duplicate(input.days.map((d) => String(d.dayNumber))) ||
      duplicate(input.vehiclePrices.map((p) => p.vehicleType))
    )
      invalid('行程明细ID、天数或车型不能重复');
    const retainedCities = new Set(
      old?.days.flatMap((d) => [
        d.departCityId,
        d.endCityId,
        ...(d.overnightCityId ? [d.overnightCityId] : []),
        ...d.hotels.map((h) => h.cityId),
        ...d.legs.flatMap((l) => [l.fromCityId, l.toCityId]),
      ]),
    );
    const retainedAttractions = new Set(
      old?.days.flatMap((d) => d.items.map((i) => i.attractionId)),
    );
    const retainedRoutes = new Set(
      old?.days.flatMap((d) => d.legs.map((l) => l.routeId)),
    );
    const city = (id: string) => {
      if (!validate) return;
      const row = config.cities.find((c) => c.id === id);
      if (!row || (!retainedCities.has(id) && row.status !== 'enabled'))
        invalid('行程引用的配置城市不可用', { cityId: id });
    };
    const normalized = allDays.map((day, index) => {
      if (index < input.days.length || day.departCityId) city(day.departCityId);
      if (index < input.days.length || day.endCityId) city(day.endCityId);
      if (day.overnightCityId) city(day.overnightCityId);
      if (
        duplicate(day.hotels.map((h) => h.tier)) ||
        duplicate(day.meals.map((m) => m.slot))
      )
        invalid('一天内酒店档次或餐食时段不能重复');
      day.hotels.forEach((hotel) => {
        city(hotel.cityId);
        if (!hotel.configHotelId) return;
        const configured = config.hotels.find(
          (h) => h.id === hotel.configHotelId,
        );
        const retained =
          old?.configVersion === input.configVersion &&
          old.days.some((d) =>
            d.hotels.some(
              (h) =>
                h.id === hotel.id && h.configHotelId === hotel.configHotelId,
            ),
          );
        if (
          validate &&
          (!configured ||
            configured.cityId !== hotel.cityId ||
            (!retained && configured.status !== 'enabled'))
        )
          invalid('所选独立站酒店不可用或与住宿城市不一致', {
            configHotelId: hotel.configHotelId,
          });
      });
      day.legs.forEach((leg) => {
        city(leg.fromCityId);
        city(leg.toCityId);
        if (leg.routeId) {
          const route = config.routes.find((r) => r.id === leg.routeId);
          if (
            validate &&
            (!route ||
              (!retainedRoutes.has(route.id) && route.status !== 'enabled'))
          )
            invalid('路线配置不可用', { routeId: leg.routeId });
          if (
            validate &&
            route &&
            (route.fromCityId !== leg.fromCityId ||
              route.toCityId !== leg.toCityId)
          )
            invalid('交通段城市与所选路线不一致');
        }
      });
      const items = day.items.map((item) => {
        if (!item.attractionId) return { ...item };
        const attraction = config.attractions.find(
          (a) => a.id === item.attractionId,
        );
        if (
          validate &&
          (!attraction ||
            (!retainedAttractions.has(attraction.id) &&
              attraction.status !== 'enabled'))
        )
          invalid('景点配置不可用', { attractionId: item.attractionId });
        if (!attraction) return { ...item };
        const copy = config.templates.find(
          (t) => t.code === attraction.copyKey && t.status === 'enabled',
        );
        return {
          ...item,
          nameZh: attraction.nameZh,
          nameEn: attraction.nameEn,
          descriptionZh: copy?.zh ?? '',
          descriptionEn: copy?.en ?? '',
        };
      });
      return { ...day, items };
    });
    const refs = this.planReferences({ ...input, days: normalized }, config);
    const issues = validate
      ? await this.resourceIssues(
          manager,
          refs,
          old ? this.planReferences(old, oldConfig) : [],
        )
      : [];
    if (validate && issues.length)
      invalid('行程引用的共享资源不可用', { issues });
    const days = normalized.slice(0, input.days.length);
    return {
      ...input,
      days,
      deletedDays: (input.deletedDays ?? []).map((entry, index) => ({
        ...entry,
        day: normalized[input.days.length + index],
      })),
      duration: days.length || input.duration,
    };
  }
  private async insertItinerary(
    manager: EntityManager,
    inquiryId: string,
    input: WebsiteItineraryInput,
    user: AuthenticatedUser,
    action: WebsiteLogAction,
    metadata: WebsiteLogMetadata = {},
  ) {
    const id = randomUUID(),
      code = await nextBusinessCode(manager, 'WIT');
    await manager.query(
      `INSERT INTO website_itineraries(id,inquiry_id,code,title,duration,start_date,pax,arrival_time,departure_time,config_version,reorder_draft,business_unit)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,(SELECT business_unit FROM website_inquiries WHERE id=$2))`,
      [
        id,
        inquiryId,
        code,
        input.title,
        input.duration,
        input.startDate,
        input.pax,
        input.arrivalTime,
        input.departureTime,
        input.configVersion,
        input.reorderDraft ? JSON.stringify(input.reorderDraft) : null,
      ],
    );
    await saveWebsiteDetails(
      manager,
      id,
      input.days,
      input.vehiclePrices,
      input.deletedDays,
    );
    await manager.query(
      "UPDATE website_inquiries SET status=CASE WHEN status='new' THEN 'planning' ELSE status END,version=version+1,updated_at=now() WHERE id=$1",
      [inquiryId],
    );
    const saved = await this.itinerary(id, user, manager);
    await this.log(
      manager,
      saved.inquiry,
      action,
      user,
      undefined,
      saved.itinerary,
      { metadata },
    );
    return saved.itinerary;
  }
  async createItinerary(
    inquiryId: string,
    input: WebsiteCreateItineraryDto,
    user: AuthenticatedUser,
  ) {
    this.permission(user, 'website:itinerary:create');
    return this.db.transaction(async (manager) => {
      const inquiry = await this.inquiry(inquiryId, user, manager, true);
      await this.mutable(inquiry, manager);
      this.version(inquiry.version, input.inquiryVersion);
      return this.insertItinerary(
        manager,
        inquiryId,
        await this.preparePlan(manager, input, inquiry.businessUnit),
        user,
        'itinerary_created',
      );
    });
  }
  private async savePlan(
    manager: EntityManager,
    itinerary: WebsiteItinerary,
    input: WebsiteItineraryInput,
    user: AuthenticatedUser,
    action: WebsiteLogAction = 'itinerary_saved',
  ) {
    await manager.query(
      `UPDATE website_itineraries SET title=$2,duration=$3,start_date=$4,pax=$5,arrival_time=$6,departure_time=$7,
      config_version=$8,reorder_draft=$9,version=version+1,updated_at=now() WHERE id=$1`,
      [
        itinerary.id,
        input.title,
        input.duration,
        input.startDate,
        input.pax,
        input.arrivalTime,
        input.departureTime,
        input.configVersion,
        input.reorderDraft ? JSON.stringify(input.reorderDraft) : null,
      ],
    );
    await saveWebsiteDetails(
      manager,
      itinerary.id,
      input.days,
      input.vehiclePrices,
      input.deletedDays,
    );
    const saved = await this.itinerary(itinerary.id, user, manager);
    await this.log(
      manager,
      saved.inquiry,
      action,
      user,
      itinerary,
      saved.itinerary,
    );
    return saved.itinerary;
  }
  async saveItinerary(
    id: string,
    input: WebsiteUpdateItineraryDto,
    user: AuthenticatedUser,
  ) {
    this.permission(user, 'website:itinerary:update');
    return this.db.transaction(async (manager) => {
      const { inquiry, itinerary } = await this.itinerary(
        id,
        user,
        manager,
        true,
      );
      await this.mutable(inquiry, manager);
      this.draft(itinerary);
      this.version(itinerary.version, input.version, true);
      return this.savePlan(
        manager,
        itinerary,
        await this.preparePlan(manager, input, inquiry.businessUnit, itinerary),
        user,
      );
    });
  }
  async copyItinerary(id: string, version: number, user: AuthenticatedUser) {
    this.permission(user, 'website:itinerary:create');
    return this.db.transaction(async (manager) => {
      const { inquiry, itinerary } = await this.itinerary(
        id,
        user,
        manager,
        true,
      );
      await this.mutable(inquiry, manager);
      this.version(itinerary.version, version, true);
      const identifiers = new Map<string, string>();
      const remapId = (id: string) => {
        const guide = id.endsWith('-guide');
        const base = guide ? id.slice(0, -6) : id;
        if (!identifiers.has(base)) identifiers.set(base, randomUUID());
        return identifiers.get(base)! + (guide ? '-guide' : '');
      };
      const copyDay = (day: WebsiteDay): WebsiteDay => ({
        ...day,
        id: remapId(day.id),
        eventOrder: (day.eventOrder ?? []).map(remapId),
        items: day.items.map((item) => ({ ...item, id: remapId(item.id) })),
        legs: day.legs.map((item) => ({ ...item, id: remapId(item.id) })),
        hotels: day.hotels.map((item) => ({ ...item, id: remapId(item.id) })),
        meals: day.meals.map((item) => ({ ...item, id: remapId(item.id) })),
        services: day.services.map((item) => ({
          ...item,
          id: remapId(item.id),
        })),
      });
      const draft = itinerary.reorderDraft;
      const clone: WebsiteItineraryInput = {
        ...itinerary,
        days: itinerary.days.map(copyDay),
        deletedDays: (itinerary.deletedDays ?? []).map((entry) => ({
          ...entry,
          day: copyDay(entry.day),
        })),
        reorderDraft: draft
          ? {
              dayIds: draft.dayIds.map(remapId),
              addedDayIds: draft.addedDayIds.map(remapId),
              deletedDays: draft.deletedDays.map((entry) => ({
                ...entry,
                id: remapId(entry.id),
              })),
              placements: draft.placements.map((entry) => ({
                dayId: remapId(entry.dayId),
                itemIds: entry.itemIds.map((id) =>
                  id.endsWith('-no-stay')
                    ? `${remapId(id.slice(0, -8))}-no-stay`
                    : remapId(id),
                ),
              })),
              copies: draft.copies.map((entry) => ({
                ...entry,
                id: remapId(entry.id),
                sourceId: remapId(entry.sourceId),
                parentId: remapId(entry.parentId),
                dayId: remapId(entry.dayId),
              })),
              overnight: draft.overnight.map((entry) => ({
                ...entry,
                dayId: remapId(entry.dayId),
              })),
            }
          : null,
        vehiclePrices: itinerary.vehiclePrices.map((price) => ({ ...price })),
      };
      // Copy preserves the historical content/configuration; it does not reselect resources.
      return this.insertItinerary(
        manager,
        inquiry.id,
        clone,
        user,
        'itinerary_copied',
        {
          creationMode: 'copy',
          sourceId: itinerary.id,
          sourceCode: itinerary.code,
        },
      );
    });
  }
  async generate(
    id: string,
    version: number,
    skeletonId: string,
    user: AuthenticatedUser,
  ) {
    this.permission(user, 'website:itinerary:update');
    return this.db.transaction(async (manager) => {
      const { inquiry, itinerary } = await this.itinerary(
        id,
        user,
        manager,
        true,
      );
      await this.mutable(inquiry, manager);
      this.draft(itinerary);
      this.version(itinerary.version, version, true);
      const config = await this.config(manager, inquiry.businessUnit);
      if (config.version !== itinerary.configVersion)
        fail('CONFLICT', '生成前请明确保存当前配置版本', HttpStatus.CONFLICT, {
          currentConfigVersion: config.version,
        });
      const generated = generateWebsiteDraft(itinerary, config, skeletonId);
      return this.savePlan(
        manager,
        itinerary,
        await this.preparePlan(
          manager,
          generated,
          inquiry.businessUnit,
          itinerary,
        ),
        user,
        'itinerary_generated',
      );
    });
  }
  async guideLanguages(query: PaginationQueryDto, user: AuthenticatedUser) {
    this.permission(user, 'website:itinerary:list');
    if (!['headquarters', 'linxi', 'website'].includes(user.scope))
      fail('AUTH_FORBIDDEN', '无独立站访问权限', HttpStatus.FORBIDDEN);
    const params = [`%${(query.keyword ?? '').trim()}%`];
    const source = `FROM (SELECT DISTINCT btrim(language) AS name FROM resource_guide_people
      WHERE status='enabled' AND deleted_at IS NULL AND length(btrim(language)) BETWEEN 1 AND 100) languages
      WHERE name ILIKE $1`;
    const count = await this.db.query<{ total: string }[]>(
      `SELECT count(*) AS total ${source}`,
      params,
    );
    const list = await this.db.query<{ id: string; name: string }[]>(
      `SELECT name AS id,name ${source} ORDER BY name LIMIT $2 OFFSET $3`,
      [...params, query.pageSize, (query.page - 1) * query.pageSize],
    );
    return {
      list,
      total: Number(count[0]?.total ?? 0),
      page: query.page,
      pageSize: query.pageSize,
    };
  }
  async validateItinerary(
    id: string,
    input: WebsiteUpdateItineraryDto,
    user: AuthenticatedUser,
  ) {
    this.permission(user, 'website:itinerary:update');
    const { inquiry, itinerary } = await this.itinerary(id, user);
    await this.mutable(inquiry, this.db.manager);
    this.draft(itinerary);
    this.version(itinerary.version, input.version, true);
    return this.previewData(this.db.manager, inquiry, {
      ...itinerary,
      ...input,
    });
  }
  private async previewData(
    manager: EntityManager,
    inquiry: WebsiteInquiry,
    itinerary: WebsiteItinerary,
  ) {
    const config = await this.config(
      manager,
      inquiry.businessUnit,
      itinerary.configVersion,
    );
    const normalized = await this.preparePlan(
      manager,
      { ...itinerary, deletedDays: [] },
      inquiry.businessUnit,
      itinerary,
    );
    itinerary = { ...itinerary, ...normalized };
    const result = buildWebsitePreview(inquiry, itinerary, config);
    if (itinerary.reorderDraft)
      result.issues.push({
        code: 'REORDER_PENDING',
        severity: 'ERROR',
        message: '请先应用已暂存的顺序调整',
      });
    try {
      await this.preparePlan(
        manager,
        normalized,
        inquiry.businessUnit,
        itinerary,
        true,
      );
    } catch (cause) {
      if (
        !(cause instanceof BusinessException) ||
        cause.code !== 'ITINERARY_INVALID'
      )
        throw cause;
      result.issues.push({
        code: cause.code,
        severity: 'ERROR',
        message: cause.message,
      });
    }
    const current = await this.config(manager, inquiry.businessUnit);
    if (current.version !== itinerary.configVersion)
      result.issues.push({
        code: 'CONFIG_VERSION_OUTDATED',
        severity: 'ERROR',
        message: '配置版本已更新，请明确选择当前配置版本并保存行程',
      });
    const cityIds = new Set(
      itinerary.days.flatMap((d) => [
        d.departCityId,
        d.endCityId,
        ...(d.overnightCityId ? [d.overnightCityId] : []),
        ...d.hotels.map((h) => h.cityId),
        ...d.legs.flatMap((l) => [l.fromCityId, l.toCityId]),
      ]),
    );
    const attractionIds = new Set(
      itinerary.days.flatMap((d) =>
        d.items.flatMap((i) => (i.attractionId ? [i.attractionId] : [])),
      ),
    );
    const routeIds = new Set(
      itinerary.days.flatMap((d) =>
        d.legs.flatMap((l) => (l.routeId ? [l.routeId] : [])),
      ),
    );
    for (const [rows, ids] of [
      [config.cities, cityIds],
      [config.attractions, attractionIds],
      [config.routes, routeIds],
    ] as const) {
      for (const id of ids)
        if (!rows.some((row) => row.id === id && row.status === 'enabled'))
          result.issues.push({
            code: 'CONFIG_NOT_READY',
            severity: 'ERROR',
            message: `引用的配置未启用：${id}`,
          });
    }
    const restaurantIds = [
      ...new Set(
        itinerary.days.flatMap((day) =>
          day.meals.flatMap((meal) =>
            meal.resourceId ? [meal.resourceId] : [],
          ),
        ),
      ),
    ];
    if (restaurantIds.length) {
      const restaurants = await manager.query<
        { id: string; city: string | null }[]
      >(
        'SELECT id,city FROM resource_restaurants WHERE id=ANY($1::uuid[]) AND deleted_at IS NULL',
        [restaurantIds],
      );
      const linkedCities = await manager.query<{ id: string; name: string }[]>(
        'SELECT id,name FROM resource_cities WHERE id=ANY($1::uuid[]) AND deleted_at IS NULL',
        [
          config.cities.flatMap((city) =>
            city.resourceId ? [city.resourceId] : [],
          ),
        ],
      );
      for (const day of itinerary.days) {
        const allowed = new Set([
          day.departCityId,
          day.endCityId,
          ...day.legs.flatMap((leg) => [leg.fromCityId, leg.toCityId]),
        ]);
        const names = config.cities
          .filter((city) => allowed.has(city.id))
          .map(
            (city) =>
              linkedCities.find((link) => link.id === city.resourceId)?.name,
          );
        for (const meal of day.meals) {
          const restaurant = restaurants.find(
            (record) => record.id === meal.resourceId,
          );
          if (
            restaurant?.city &&
            names.length &&
            names.every(Boolean) &&
            !names.includes(restaurant.city)
          )
            result.issues.push({
              code: 'VAL-E03',
              severity: 'ERROR',
              dayNumber: day.dayNumber,
              message: `餐厅不在当天行程城市：${meal.restaurantZh || meal.restaurantEn}`,
            });
          else if (
            restaurant?.city &&
            !names.includes(restaurant.city) &&
            names.some((name) => !name)
          )
            result.issues.push({
              code: 'VAL-W04',
              severity: 'WARNING',
              dayNumber: day.dayNumber,
              message: '城市未关联公共城市，请核对餐厅所在城市',
            });
        }
      }
    }
    result.issues.push(
      ...(await this.resourceIssues(
        manager,
        this.planReferences(itinerary, config),
      )),
    );
    return result;
  }
  private async frozen(
    manager: EntityManager,
    id: string,
  ): Promise<WebsiteQuotation | null> {
    const rows = await manager.query<{ snapshot: WebsiteQuotation }[]>(
      'SELECT snapshot FROM website_quotations WHERE itinerary_id=$1',
      [id],
    );
    return rows[0]?.snapshot ?? null;
  }
  async preview(id: string, user: AuthenticatedUser) {
    const { inquiry, itinerary } = await this.itinerary(id, user);
    if (itinerary.status === 'quoted') {
      const frozen = await this.frozen(this.db.manager, id);
      if (!frozen) fail('PDF_NOT_READY', '冻结报价不存在', HttpStatus.CONFLICT);
      return frozen;
    }
    return this.previewData(this.db.manager, inquiry, itinerary);
  }
  async confirm(
    id: string,
    input: WebsiteConfirmDto,
    user: AuthenticatedUser,
  ): Promise<WebsiteQuotation> {
    this.permission(user, 'website:itinerary:confirm');
    return this.db.transaction(async (manager) => {
      const { inquiry, itinerary } = await this.itinerary(
        id,
        user,
        manager,
        true,
      );
      const existing = await this.frozen(manager, id);
      if (existing) return existing;
      await this.mutable(inquiry, manager);
      this.draft(itinerary);
      this.version(itinerary.version, input.version, true);
      this.version(inquiry.version, input.inquiryVersion);
      await manager.query(
        'SELECT id FROM website_config_current WHERE business_unit=$1 FOR SHARE',
        [inquiry.businessUnit],
      );
      const current = await this.config(manager, inquiry.businessUnit);
      if (current.version !== itinerary.configVersion)
        fail(
          'CONFLICT',
          '配置已更新，请明确保存当前配置版本后再确认',
          HttpStatus.CONFLICT,
          { currentConfigVersion: current.version },
        );
      const preview = await this.previewData(manager, inquiry, itinerary);
      const errors = preview.issues.filter((i) => i.severity === 'ERROR');
      if (errors.length)
        fail('PDF_NOT_READY', '正式报价校验未通过', HttpStatus.BAD_REQUEST, {
          issues: preview.issues,
        });
      const warnings = [
        ...new Set(
          preview.issues
            .filter((i) => i.severity === 'WARNING')
            .map((i) => i.code),
        ),
      ].sort();
      const acknowledged = [...input.acknowledgedWarnings].sort();
      if (JSON.stringify(warnings) !== JSON.stringify(acknowledged))
        fail(
          'PDF_NOT_READY',
          '请确认当前版本的全部警告',
          HttpStatus.BAD_REQUEST,
          { issues: preview.issues },
        );
      const quotation: WebsiteQuotation = {
        ...preview,
        id: randomUUID(),
        code: await nextBusinessCode(manager, 'WQT'),
        confirmedAt: new Date().toISOString(),
        confirmedBy: user.nickname,
        acknowledgedWarnings: acknowledged,
      };
      await manager.query(
        'INSERT INTO website_quotations(id,itinerary_id,code,snapshot,confirmed_at,confirmed_by) VALUES($1,$2,$3,$4::jsonb,$5,$6)',
        [
          quotation.id,
          id,
          quotation.code,
          JSON.stringify(quotation),
          quotation.confirmedAt,
          user.id,
        ],
      );
      await manager.query(
        "UPDATE website_itineraries SET status='quoted',version=version+1,updated_at=now() WHERE id=$1",
        [id],
      );
      await manager.query(
        "UPDATE website_inquiries SET status='quoted',version=version+1,updated_at=now() WHERE id=$1",
        [inquiry.id],
      );
      await this.log(
        manager,
        inquiry,
        'quotation_confirmed',
        user,
        itinerary,
        { ...itinerary, status: 'quoted' },
        { detail: quotation.code, metadata: { quotationCode: quotation.code } },
      );
      return quotation;
    });
  }
  async recordDownload(id: string, user: AuthenticatedUser) {
    this.permission(user, 'website:itinerary:download');
    await this.itinerary(id, user);
    const rows = await this.db.query<{ firstDownloadedAt: string }[]>(
      `WITH updated AS (UPDATE website_quotations SET first_downloaded_at = COALESCE(first_downloaded_at, now()),
       first_downloaded_by = COALESCE(first_downloaded_by, $2)
       WHERE itinerary_id = $1 RETURNING first_downloaded_at AS "firstDownloadedAt") SELECT * FROM updated`,
      [id, user.id],
    );
    if (!rows[0])
      fail('PDF_NOT_READY', '该行程尚未确认报价', HttpStatus.CONFLICT);
    return rows[0];
  }
  async quotation(id: string, user: AuthenticatedUser) {
    this.permission(user, 'website:itinerary:download');
    await this.itinerary(id, user);
    const result = await this.frozen(this.db.manager, id);
    if (!result)
      fail('PDF_NOT_READY', '该行程尚未确认报价', HttpStatus.CONFLICT);
    return result;
  }
  async resource(kind: string, id: string, user: AuthenticatedUser) {
    this.permission(user, 'website:config:list');
    if (!Object.hasOwn(resourceTables, kind))
      fail('BAD_REQUEST', '不支持的资源类型', HttpStatus.BAD_REQUEST);
    const resourceKind = kind as ResourceKind;
    const extra =
      resourceKind === 'attraction'
        ? ',area AS city'
        : resourceKind === 'hotel' || resourceKind === 'restaurant'
          ? ',city'
          : resourceKind === 'transport'
            ? ',seats'
            : '';
    // Historical references may be disabled; this read does not authorize selection.
    const rows = await this.db.manager.query<ResourceDetail[]>(
      `SELECT id,name,status${extra} FROM ${resourceTables[resourceKind]} WHERE id=$1 AND deleted_at IS NULL`,
      [id],
    );
    if (!rows[0]) fail('NOT_FOUND', '公共资源不存在', HttpStatus.NOT_FOUND);
    return rows[0];
  }
  async resources(
    kind: string,
    query: WebsiteResourceQuery,
    user: AuthenticatedUser,
  ) {
    this.permission(user, 'website:config:list');
    if (!Object.hasOwn(resourceTables, kind))
      fail('BAD_REQUEST', '不支持的资源类型', HttpStatus.BAD_REQUEST);
    const resourceKind = kind as ResourceKind;
    const table = resourceTables[resourceKind];
    const cityColumn =
      resourceKind === 'attraction'
        ? 'area'
        : ['hotel', 'restaurant'].includes(resourceKind)
          ? 'city'
          : '';
    const extra =
      resourceKind === 'transport'
        ? ',seats'
        : cityColumn
          ? `,${cityColumn} AS city`
          : '';
    const params: unknown[] = [];
    let where = ` WHERE deleted_at IS NULL AND status='enabled'`;
    if (query.keyword) {
      params.push(`%${query.keyword}%`);
      where += ` AND (name ILIKE $${params.length} OR code ILIKE $${params.length})`;
    }
    const city = query.city?.trim();
    if (city) {
      if (!cityColumn)
        fail('BAD_REQUEST', '该资源类型不支持城市筛选', HttpStatus.BAD_REQUEST);
      params.push(city);
      where += ` AND ${cityColumn} = $${params.length}`;
    }
    const count = await this.db.manager.query<{ total: string }[]>(
      `SELECT count(*)::text AS total FROM ${table}${where}`,
      params,
    );
    const list = await this.db.manager.query<ResourceOption[]>(
      `SELECT id,name${extra} FROM ${table}${where} ORDER BY name,id
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.pageSize, (query.page - 1) * query.pageSize],
    );
    return {
      list,
      total: Number(count[0].total),
      page: query.page,
      pageSize: query.pageSize,
    };
  }
}
