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
  WebsiteConfig,
  WebsiteInquiry,
  WebsiteInquiryInput,
  WebsiteItinerary,
  WebsiteItineraryInput,
  WebsiteLog,
  WebsiteQuotation,
  WebsiteValidation,
} from './website.types';
import type {
  WebsiteConfirmDto,
  WebsiteCreateItineraryDto,
  WebsiteInquiryQuery,
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
const inquiryColumns = `i.id,i.code,i.customer_name AS "customerName",i.planned_days AS "plannedDays",
  EXISTS(SELECT 1 FROM tours t WHERE t.source_module='website' AND t.inquiry_id=i.id AND t.status='active') AS "hasActiveTour",
  i.country_item_id AS "countryItemId",i.country_code AS "countryCode",i.country_or_region AS "countryOrRegion",
  i.requirements,i.owner_id AS "ownerId",i.owner,i.phone,i.email,i.start_date::text AS "startDate",i.pax,
  i.arrival_time AS "arrivalTime",i.departure_time AS "departureTime",i.destinations,
  i.internal_remark AS "internalRemark",i.lost_reason AS "lostReason",i.status,i.version,
  to_char(i.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",
  to_char(i.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt"`;
const itineraryColumns = `id,inquiry_id AS "inquiryId",code,title,duration,start_date::text AS "startDate",pax,
  arrival_time AS "arrivalTime",departure_time AS "departureTime",config_version AS "configVersion",status,version,
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

  private permission(user: AuthenticatedUser, permission: string) {
    if (
      !['website', 'headquarters'].includes(user.scope) ||
      !user.permissions.includes(permission)
    )
      fail('AUTH_FORBIDDEN', '无独立站访问权限', HttpStatus.FORBIDDEN);
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
    const scope = this.allInquiries(user)
      ? ''
      : ` AND i.owner_id=$${params.push(user.id)}`;
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
    version?: number,
  ): Promise<WebsiteConfig> {
    const rows = await manager.query<{ config: WebsiteConfig }[]>(
      version === undefined
        ? 'SELECT v.config FROM website_config_versions v JOIN website_config_current c ON c.version=v.version WHERE c.id=1'
        : 'SELECT config FROM website_config_versions WHERE version=$1',
      version === undefined ? [] : [version],
    );
    if (!rows[0])
      fail('NOT_FOUND', '独立站配置版本不存在', HttpStatus.NOT_FOUND, {
        configVersion: version,
      });
    return rows[0].config;
  }
  async getConfig(user: AuthenticatedUser, version?: number) {
    this.permission(user, 'website:config:list');
    return this.config(this.db.manager, version);
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
        { id: string; library: string; status: string; deleted: boolean }[]
      >(
        `SELECT id,library,status,deleted_at IS NOT NULL AS deleted FROM ${resourceTables[kind]} WHERE id=ANY($1::uuid[])${manager.queryRunner?.isTransactionActive ? ' FOR SHARE' : ''}`,
        [[...new Set(selected.map((r) => r.id))]],
      );
      for (const ref of selected) {
        const row = rows.find((r) => r.id === ref.id);
        if (
          !row ||
          row.library !== 'shared' ||
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
  async saveConfig(input: WebsiteConfig, user: AuthenticatedUser) {
    this.permission(user, 'website:config:update');
    validateWebsiteConfig(input);
    return this.db.transaction(async (manager) => {
      await manager.query(
        'SELECT id FROM website_config_current WHERE id=1 FOR UPDATE',
      );
      const old = await this.config(manager);
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
      const saved: WebsiteConfig = { ...input, version: input.version + 1 };
      await manager.query(
        'INSERT INTO website_config_versions(version,config,created_by) VALUES($1,$2::jsonb,$3)',
        [saved.version, JSON.stringify(saved), user.id],
      );
      await manager.query(
        'UPDATE website_config_current SET version=$1 WHERE id=1',
        [saved.version],
      );
      return saved;
    });
  }
  private async owner(
    manager: EntityManager,
    id: string,
  ): Promise<OwnerOption> {
    const user = await manager
      .createQueryBuilder(UserEntity, 'u')
      .where('u.id=:id', { id })
      .setLock('pessimistic_write')
      .getOne();
    const eligible = await manager.query<{ id: string }[]>(
      `SELECT i.id FROM user_identities i
      JOIN identity_roles ir ON ir.identity_id=i.id JOIN roles r ON r.id=ir.role_id
      WHERE i.user_id=$1 AND i.scope='website' AND r.code='COORDINATOR' AND r.is_enabled=true`,
      [id],
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
  async owners(user: AuthenticatedUser): Promise<OwnerOption[]> {
    this.permission(user, 'website:inquiry:list');
    const scope = this.allInquiries(user) ? '' : ' AND u.id=$1';
    return this.db.manager.query<OwnerOption[]>(
      `SELECT DISTINCT u.id,u.nickname AS name,u.username FROM users u
      JOIN user_identities i ON i.user_id=u.id JOIN identity_roles ir ON ir.identity_id=i.id JOIN roles r ON r.id=ir.role_id
      WHERE u.deleted_at IS NULL AND u.status='enabled' AND i.scope='website'
      AND r.code='COORDINATOR' AND r.is_enabled=true${scope} ORDER BY name,id`,
      scope ? [user.id] : [],
    );
  }
  async list(query: WebsiteInquiryQuery, user: AuthenticatedUser) {
    this.permission(user, 'website:inquiry:list');
    const params: unknown[] = [];
    const clauses: string[] = [];
    if (!this.allInquiries(user))
      clauses.push(`i.owner_id=$${params.push(user.id)}`);
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
    old?: WebsiteInquiry,
  ) {
    if (!input.destinations.length) return;
    const config = await this.config(manager);
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
    inquiryId: string,
    action: string,
    targetId: string,
    user: AuthenticatedUser,
    detail = '',
  ) {
    await manager.query(
      `INSERT INTO website_logs(id,inquiry_id,action,target_id,actor_id,actor_name,detail)
      VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [
        randomUUID(),
        inquiryId,
        action,
        targetId,
        user.id,
        user.nickname,
        detail,
      ],
    );
  }
  async create(input: WebsiteInquiryInput, user: AuthenticatedUser) {
    this.permission(user, 'website:inquiry:create');
    if (input.status && input.status !== 'new') invalid('新询盘状态必须为new');
    return this.db.transaction(async (manager) => {
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
      const owner = await this.owner(manager, ownerId);
      await this.inquiryDestinations(manager, input);
      const country = await requireDictionaryItem(
        manager,
        'country-region',
        input.countryItemId,
      );
      const id = randomUUID(),
        code = await nextBusinessCode(manager, 'WIQ');
      await manager.query(
        `INSERT INTO website_inquiries(id,code,customer_name,planned_days,requirements,owner_id,owner,
        phone,email,start_date,pax,arrival_time,departure_time,destinations,internal_remark,lost_reason,status,
        country_item_id,country_code,country_or_region)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'','new',$16,$17,$18)`,
        [
          id,
          code,
          input.customerName,
          input.plannedDays,
          input.requirements,
          owner.id,
          owner.name,
          input.phone,
          input.email,
          input.startDate,
          input.pax,
          input.arrivalTime,
          input.departureTime,
          input.destinations,
          input.internalRemark,
          country.id,
          country.code,
          country.name,
        ],
      );
      await this.log(manager, id, 'inquiry_created', id, user);
      return this.inquiry(id, user, manager);
    });
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
      await this.inquiryDestinations(manager, input, old);
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
        `UPDATE website_inquiries SET country_item_id=$15,country_code=$16,country_or_region=$17,customer_name=$2,planned_days=$3,requirements=$4,phone=$5,email=$6,
        start_date=$7,pax=$8,arrival_time=$9,departure_time=$10,destinations=$11,internal_remark=$12,lost_reason=$13,
        status=$14,version=version+1,updated_at=now() WHERE id=$1`,
        [
          id,
          input.customerName,
          input.plannedDays,
          input.requirements,
          input.phone,
          input.email,
          input.startDate,
          input.pax,
          input.arrivalTime,
          input.departureTime,
          input.destinations,
          input.internalRemark,
          input.lostReason,
          status,
          country.id,
          country.code,
          country.name,
        ],
      );
      await this.log(
        manager,
        id,
        status === 'lost' ? 'inquiry_lost' : 'inquiry_updated',
        id,
        user,
        status === 'lost' ? input.lostReason : '',
      );
      return this.inquiry(id, user, manager);
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
      const owner = await this.owner(manager, input.ownerId);
      const old = await this.inquiry(id, user, manager, true);
      await this.mutable(old, manager);
      this.version(old.version, input.version);
      if (old.ownerId === owner.id) invalid('新负责人不能与当前负责人相同');
      await manager.query(
        'UPDATE website_inquiries SET owner_id=$2,owner=$3,version=version+1,updated_at=now() WHERE id=$1',
        [id, owner.id, owner.name],
      );
      await this.log(
        manager,
        id,
        'inquiry_transferred',
        id,
        user,
        `${old.owner} → ${owner.name}：${input.reason}`,
      );
      return this.inquiry(id, user, manager);
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
      await this.log(manager, id, 'inquiry_archived', id, user);
      return this.inquiry(id, user, manager);
    });
  }
  async logs(
    id: string,
    query: { page: number; pageSize: number },
    user: AuthenticatedUser,
  ) {
    await this.inquiry(id, user);
    const count = await this.db.manager.query<{ total: string }[]>(
      'SELECT count(*)::text AS total FROM website_logs WHERE inquiry_id=$1',
      [id],
    );
    const list = await this.db.manager.query<WebsiteLog[]>(
      `SELECT id,action,target_id AS "targetId",actor_name AS "actorName",detail,
      to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "occurredAt"
      FROM website_logs WHERE inquiry_id=$1 ORDER BY occurred_at DESC,id DESC LIMIT $2 OFFSET $3`,
      [id, query.pageSize, (query.page - 1) * query.pageSize],
    );
    return {
      list,
      total: Number(count[0].total),
      page: query.page,
      pageSize: query.pageSize,
    };
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
    old?: WebsiteItinerary,
  ): Promise<WebsiteItineraryInput> {
    const config = await this.config(manager, input.configVersion);
    const oldConfig = old
      ? await this.config(manager, old.configVersion)
      : config;
    const ids = input.days.flatMap((d) => [
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
      const row = config.cities.find((c) => c.id === id);
      if (!row || (!retainedCities.has(id) && row.status !== 'enabled'))
        invalid('行程引用的配置城市不可用', { cityId: id });
    };
    const days = input.days.map((day) => {
      city(day.departCityId);
      city(day.endCityId);
      if (day.overnightCityId) city(day.overnightCityId);
      if (
        duplicate(day.hotels.map((h) => h.tier)) ||
        duplicate(day.meals.map((m) => m.slot))
      )
        invalid('一天内酒店档次或餐食时段不能重复');
      day.hotels.forEach((h) => city(h.cityId));
      day.legs.forEach((leg) => {
        city(leg.fromCityId);
        city(leg.toCityId);
        if (leg.routeId) {
          const route = config.routes.find((r) => r.id === leg.routeId);
          if (
            !route ||
            (!retainedRoutes.has(route.id) && route.status !== 'enabled')
          )
            invalid('路线配置不可用', { routeId: leg.routeId });
          if (
            route.fromCityId !== leg.fromCityId ||
            route.toCityId !== leg.toCityId
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
          !attraction ||
          (!retainedAttractions.has(attraction.id) &&
            attraction.status !== 'enabled')
        )
          invalid('景点配置不可用', { attractionId: item.attractionId });
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
    const refs = this.planReferences(input, config);
    const issues = await this.resourceIssues(
      manager,
      refs,
      old ? this.planReferences(old, oldConfig) : [],
    );
    if (issues.length) invalid('行程引用的共享资源不可用', { issues });
    return { ...input, days };
  }
  private async insertItinerary(
    manager: EntityManager,
    inquiryId: string,
    input: WebsiteItineraryInput,
    user: AuthenticatedUser,
    action: string,
  ) {
    const id = randomUUID(),
      code = await nextBusinessCode(manager, 'WIT');
    await manager.query(
      `INSERT INTO website_itineraries(id,inquiry_id,code,title,duration,start_date,pax,arrival_time,departure_time,config_version)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
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
      ],
    );
    await saveWebsiteDetails(manager, id, input.days, input.vehiclePrices);
    await manager.query(
      "UPDATE website_inquiries SET status=CASE WHEN status='new' THEN 'planning' ELSE status END,version=version+1,updated_at=now() WHERE id=$1",
      [inquiryId],
    );
    await this.log(manager, inquiryId, action, id, user);
    return (await this.itinerary(id, user, manager)).itinerary;
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
        await this.preparePlan(manager, input),
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
    action = 'itinerary_saved',
  ) {
    await manager.query(
      `UPDATE website_itineraries SET title=$2,duration=$3,start_date=$4,pax=$5,arrival_time=$6,departure_time=$7,
      config_version=$8,version=version+1,updated_at=now() WHERE id=$1`,
      [
        itinerary.id,
        input.title,
        input.duration,
        input.startDate,
        input.pax,
        input.arrivalTime,
        input.departureTime,
        input.configVersion,
      ],
    );
    await saveWebsiteDetails(
      manager,
      itinerary.id,
      input.days,
      input.vehiclePrices,
    );
    await this.log(manager, itinerary.inquiryId, action, itinerary.id, user);
    return (await this.itinerary(itinerary.id, user, manager)).itinerary;
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
        await this.preparePlan(manager, input, itinerary),
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
      const clone: WebsiteItineraryInput = {
        ...itinerary,
        days: itinerary.days.map((day) => ({
          ...day,
          id: randomUUID(),
          items: day.items.map((item) => ({ ...item, id: randomUUID() })),
          legs: day.legs.map((leg) => ({ ...leg, id: randomUUID() })),
          hotels: day.hotels.map((hotel) => ({ ...hotel, id: randomUUID() })),
          meals: day.meals.map((meal) => ({ ...meal, id: randomUUID() })),
          services: day.services.map((service) => ({
            ...service,
            id: randomUUID(),
          })),
        })),
        vehiclePrices: itinerary.vehiclePrices.map((price) => ({ ...price })),
      };
      // Copy preserves the historical content/configuration; it does not reselect resources.
      return this.insertItinerary(
        manager,
        inquiry.id,
        clone,
        user,
        'itinerary_copied',
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
      const config = await this.config(manager);
      if (config.version !== itinerary.configVersion)
        fail('CONFLICT', '生成前请明确保存当前配置版本', HttpStatus.CONFLICT, {
          currentConfigVersion: config.version,
        });
      const generated = generateWebsiteDraft(itinerary, config, skeletonId);
      return this.savePlan(
        manager,
        itinerary,
        await this.preparePlan(manager, generated, itinerary),
        user,
        'itinerary_generated',
      );
    });
  }
  private async previewData(
    manager: EntityManager,
    inquiry: WebsiteInquiry,
    itinerary: WebsiteItinerary,
  ) {
    const config = await this.config(manager, itinerary.configVersion);
    const result = buildWebsitePreview(inquiry, itinerary, config);
    const current = await this.config(manager);
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
        'SELECT id FROM website_config_current WHERE id=1 FOR SHARE',
      );
      const current = await this.config(manager);
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
        inquiry.id,
        'quotation_confirmed',
        id,
        user,
        quotation.code,
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
    const city =
      resourceKind === 'attraction'
        ? ',area AS city'
        : ['hotel', 'restaurant'].includes(resourceKind)
          ? ',city'
          : '';
    const extra = resourceKind === 'transport' ? ',seats' : city;
    const keyword = query.keyword
      ? ` AND (name ILIKE $1 OR code ILIKE $1)`
      : '';
    const params: unknown[] = query.keyword ? [`%${query.keyword}%`] : [];
    const where = ` WHERE library='shared' AND deleted_at IS NULL AND status='enabled'${keyword}`;
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
