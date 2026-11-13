import { isHeadquartersBusinessAdmin } from '../auth/account-access';
import { appendFollowUp, cancelInquiryReminders } from './follow-ups';
import { InquiryRemindersService } from './inquiry-reminders.service';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import {
  buildCustomerPresentation,
  exportSnapshot,
} from './customer-presentation';
import {
  UserIdentityEntity,
  BusinessUnit,
} from '../users/user-identity.entity';
import { saveItineraryData, loadItineraryData } from './structured-itinerary';
import { recordPriceAdjustments } from './price-adjustments';
import { saveFrozenDetails } from './structured-quotes';
import { requireDictionaryItem } from '../common/dictionary-items';
import { canDeleteInquiry } from '../common/inquiry-delete';
import { assertNoActiveTour } from '../common/tour-lock';
import { nextBusinessCode } from '../common/business-code';
import { ResourceStatus } from '../resources/common/resource.constants';
import { HttpStatus, Injectable } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { RestaurantEntity } from '../resources/restaurants/restaurant.entity';
import { AttractionEntity } from '../resources/attractions/attraction.entity';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { AuthenticatedUser } from '../auth/auth.types';
import { UserEntity, UserStatus } from '../users/user.entity';
import {
  AgencyEntity,
  AgencyContactEntity,
} from '../resources/agencies/agency.entity';
import { AgenciesService } from '../resources/agencies/agencies.service';
import { BusinessException } from '../common/exceptions/business.exception';
import type { ErrorCodeValue } from '../common/constants/error-code';
import {
  ACTIONS,
  FollowUpInput,
  ConfirmPdfDto,
  ContactInput,
  CopyItineraryDto,
  InquiryInput,
  InquiryQuery,
  ItineraryInput,
  LogAction,
  LogQuery,
  UpdateInquiryDto,
  TransferInquiryDto,
  UpdateItineraryDto,
} from './inquiry.dto';
import {
  FieldChange,
  InquiryEntity,
  InquiryLogEntity,
  ItineraryEntity,
  ItineraryQuoteEntity,
  CurrentPdfData,
} from './inquiry.entity';
import { diffChanges, contextualChanges } from './changes';
import { dateAt, invalid, ItineraryValidation } from './itinerary-validation';
import { calculateItineraryQuote } from './quote-pricing';
interface Actor extends AuthenticatedUser {
  name: string;
  admin: boolean;
  ip: string;
  requestId: string;
}

function fail(
  code: ErrorCodeValue,
  status: HttpStatus,
  details?: Record<string, unknown>,
): never {
  throw new BusinessException({ code, message: code, status, details });
}
@Injectable()
export class InquiriesService {
  constructor(
    private readonly db: DataSource,
    private readonly validation: ItineraryValidation,
    private readonly agencies: AgenciesService,
    private readonly reminders: InquiryRemindersService,
  ) {}
  actor(user: AuthenticatedUser, request: Request): Promise<Actor> {
    return Promise.resolve({
      ...user,
      name: user.nickname,
      admin:
        isHeadquartersBusinessAdmin(user) ||
        user.roles.includes('BUSINESS_MANAGER'),
      ip: request.ip ?? '',
      requestId: String((request as Request & { id?: string }).id ?? ''),
    });
  }
  private queryInquiries(actor: Actor, manager = this.db.manager) {
    if (!actor.permissions.includes('inquiry:list'))
      fail('AUTH_FORBIDDEN', HttpStatus.FORBIDDEN);
    const query = manager.createQueryBuilder(InquiryEntity, 'i');
    this.scopeInquiryQuery(query, actor);
    return query;
  }
  private scopeInquiryQuery(
    query: {
      andWhere: (sql: string, params: Record<string, unknown>) => unknown;
    },
    actor: Actor,
  ) {
    if (!actor.permissions.includes('inquiry:list'))
      fail('AUTH_FORBIDDEN', HttpStatus.FORBIDDEN);
    if (actor.scope !== 'headquarters') {
      query.andWhere('i.businessUnit = :businessUnit', {
        businessUnit: actor.scope,
      });
      if (!actor.admin)
        query.andWhere('i.ownerId = :actorId', { actorId: actor.id });
    }
  }
  private permission(actor: Actor, permission: string) {
    if (!actor.permissions.includes(permission))
      fail('AUTH_FORBIDDEN', HttpStatus.FORBIDDEN);
  }
  private async inquiry(
    id: string,
    actor: Actor,
    manager = this.db.manager,
    lock = false,
  ) {
    const query = this.queryInquiries(actor, manager).andWhere('i.id = :id', {
      id,
    });
    if (lock) query.setLock('pessimistic_write');
    const row = await query.getOne();
    if (!row) fail('INQUIRY_NOT_FOUND', HttpStatus.NOT_FOUND);
    return row;
  }
  private writable(inquiry: InquiryEntity, actor: Actor) {
    this.permission(actor, 'inquiry:update');
    if (['lost', 'archived'].includes(inquiry.status))
      fail('INQUIRY_READ_ONLY', HttpStatus.CONFLICT);
  }
  private checkVersion(current: number, version: number, itinerary = false) {
    if (current !== version)
      fail(
        itinerary ? 'ITINERARY_VERSION_CONFLICT' : 'INQUIRY_VERSION_CONFLICT',
        HttpStatus.CONFLICT,
      );
  }
  private inquiryResponse(
    row: InquiryEntity,
    actor?: Actor,
    hasActiveTour = false,
  ) {
    return {
      ...row.data,
      hasActiveTour,
      ...(actor
        ? {
            canDelete:
              !hasActiveTour &&
              canDeleteInquiry(actor, row.ownerId, 'inquiry:delete'),
          }
        : {}),
      id: row.id,
      code: row.code,
      businessUnit: row.businessUnit,
      ownerId: row.ownerId,
      owner: row.owner,
      status: row.status,
      creator: row.creator,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      version: row.version,
    };
  }
  private itineraryResponse(row: ItineraryEntity, generatedAt = '') {
    return {
      ...row.data,
      id: row.id,
      inquiryId: row.inquiryId,
      code: row.code,
      status: row.status,
      creator: row.creator,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      version: row.version,
      days: row.data.dailyPlans.length,
      displayDays:
        row.data.dailyPlans.length +
        (row.data.customerDisplayMode === 'returnArrival' ? 1 : 0),
      accommodationNights: row.data.dailyPlans.filter(
        (d) => !!d.overnightDestination,
      ).length,
      endDate: dateAt(row.data.startDate, row.data.dailyPlans.length - 1),
      quoteGeneratedAt: generatedAt,
    };
  }
  async countByStatus(actor: Actor) {
    return this.queryInquiries(actor)
      .select('i.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .andWhere('i.status IN (:...statuses)', {
        statuses: ['new', 'planning', 'quoted'],
      })
      .groupBy('i.status')
      .getRawMany<{ status: string; count: string }>();
  }

  async countCreatedByDate(from: string, until: string, actor: Actor) {
    const date = `to_char(i.createdAt AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD')`;
    return this.queryInquiries(actor)
      .select(date, 'date')
      .addSelect('COUNT(*)', 'count')
      .andWhere('i.createdAt >= :from AND i.createdAt < :until', {
        from: `${from}T00:00:00+08:00`,
        until: `${until}T00:00:00+08:00`,
      })
      .groupBy(date)
      .getRawMany<{ date: string; count: string }>();
  }

  async list(query: InquiryQuery, actor: Actor) {
    const qb = this.queryInquiries(actor);
    if (query.businessUnit) {
      if (actor.scope !== 'headquarters' && query.businessUnit !== actor.scope)
        fail('AUTH_FORBIDDEN', HttpStatus.FORBIDDEN);
      qb.andWhere('i.businessUnit = :filterBusinessUnit', {
        filterBusinessUnit: query.businessUnit,
      });
    }
    if (query.code?.trim())
      qb.andWhere('LOWER(i.code) = LOWER(:code)', { code: query.code.trim() });
    if (query.status)
      qb.andWhere('i.status = :status', { status: query.status });
    if (query.ownerId)
      qb.andWhere('i.ownerId = :ownerId', { ownerId: query.ownerId });
    if (query.sourceChannel)
      qb.andWhere('i.sourceChannel = :source', {
        source: query.sourceChannel,
      });
    if (query.keyword?.trim())
      qb.andWhere(
        '(i.code ILIKE :keyword OR i.agencyName ILIKE :keyword OR i.contactName ILIKE :keyword OR i.email ILIKE :keyword OR i.phone ILIKE :keyword)',
        { keyword: `%${query.keyword.trim()}%` },
      );
    const [rows, total] = await qb
      .orderBy('i.createdAt', 'DESC')
      .addOrderBy('i.id', 'DESC')
      .skip((query.page - 1) * query.pageSize)
      .take(query.pageSize)
      .getManyAndCount();
    const active = await this.db.query<{ inquiry_id: string }[]>(
      `SELECT inquiry_id FROM tours WHERE source_module='standard' AND status='active' AND inquiry_id=ANY($1::uuid[])`,
      [rows.map((row) => row.id)],
    );
    const activeIds = new Set(active.map((row) => row.inquiry_id));
    return {
      list: rows.map((row) =>
        this.inquiryResponse(row, actor, activeIds.has(row.id)),
      ),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }
  async detail(id: string, actor: Actor) {
    const row = await this.inquiry(id, actor);
    const active = await this.db.query<unknown[]>(
      `SELECT 1 FROM tours WHERE source_module='standard' AND inquiry_id=$1 AND status='active'`,
      [id],
    );
    return this.inquiryResponse(row, actor, active.length > 0);
  }
  async owners(actor: Actor, businessUnit?: BusinessUnit) {
    this.permission(actor, 'inquiry:list');
    const scope = actor.scope === 'headquarters' ? businessUnit : actor.scope;
    const qb = this.db.manager
      .createQueryBuilder(UserEntity, 'u')
      .innerJoin('u.identities', 'identity')
      .innerJoin('identity.roles', 'r')
      .where(
        "u.status=:status AND u.isSuperuser=false AND r.code='COORDINATOR' AND r.isEnabled=true",
        { status: UserStatus.Enabled },
      );
    if (scope) qb.andWhere('identity.scope=:scope', { scope });
    return (await qb.orderBy('u.nickname', 'ASC').getMany()).map((u) => ({
      id: u.id,
      name: u.nickname,
      username: u.username,
    }));
  }
  private async owner(
    id: string,
    actor: Actor,
    manager: EntityManager,
    scope: BusinessUnit,
    transfer = false,
    linkedAgency = false,
  ) {
    if (!actor.admin && id !== actor.id && !linkedAgency)
      fail('INQUIRY_OWNER_INVALID', HttpStatus.FORBIDDEN);
    const user = await manager.findOne(UserEntity, {
      where: { id, status: UserStatus.Enabled },
      lock: { mode: 'pessimistic_write' },
    });
    const identity = await manager.findOne(UserIdentityEntity, {
      where: { userId: id, scope },
      relations: { roles: true },
    });
    if (
      !user ||
      !identity?.roles.some(
        (r) =>
          r.isEnabled &&
          (r.code === 'COORDINATOR' ||
            (!transfer && id === actor.id && r.code === 'BUSINESS_MANAGER')),
      )
    )
      fail('INQUIRY_OWNER_INVALID', HttpStatus.BAD_REQUEST);
    return user;
  }
  private async data(
    input: InquiryInput,
    manager: EntityManager,
    previous?: InquiryEntity,
    businessUnit?: BusinessUnit,
  ) {
    if (input.isSeries) {
      if ((businessUnit ?? previous?.businessUnit) !== 'shengxu')
        invalid('系列询盘仅用于盛旭');
      if (
        input.agencyId !== undefined ||
        input.contactId !== undefined ||
        input.plannedDays !== undefined ||
        input.sourceChannel !== undefined
      )
        invalid('系列询盘不填写组团社、联系人、来源渠道和计划天数');
      const country =
        previous?.countryItemId === input.countryItemId
          ? {
              id: previous.countryItemId,
              code: previous.countryCode,
              name: previous.countryOrRegion,
            }
          : await requireDictionaryItem(
              manager,
              'country-region',
              input.countryItemId,
            );
      return {
        isSeries: true,
        agencyId: null,
        contactId: null,
        agencyCode: '',
        agencyName: '',
        contactName: '',
        email: '',
        phone: '',
        countryItemId: country.id,
        countryCode: country.code,
        countryOrRegion: country.name,
        sourceChannel: '',
        originalMessage: input.originalMessage?.trim() ?? '',
        internalRemark: previous?.internalRemark ?? input.internalRemark,
        plannedDays: null,
        nextFollowUpAt: previous?.nextFollowUpAt ?? null,
        lostReason: input.status === 'lost' ? input.lostReason.trim() : '',
      };
    }
    if (!input.originalMessage?.trim()) invalid('请填写客户原始消息');
    const unchanged =
      previous?.data.agencyId === input.agencyId &&
      previous.data.contactId === input.contactId;
    let snapshot = previous?.data;
    if (!unchanged) {
      const agency = await manager.findOneBy(AgencyEntity, {
        id: input.agencyId,
      });
      const contact = await manager.findOneBy(AgencyContactEntity, {
        id: input.contactId,
        agencyId: input.agencyId,
      });
      if (
        !agency ||
        agency.status !== ResourceStatus.Enabled ||
        (previous?.data.agencyId !== input.agencyId &&
          agency.businessUnit !==
            (businessUnit ?? (previous!.businessUnit as BusinessUnit))) ||
        !contact
      )
        fail('INQUIRY_CONTACT_INVALID', HttpStatus.BAD_REQUEST);
      snapshot = {
        agencyId: agency.id,
        contactId: contact.id,
        agencyCode: agency.code,
        agencyName: agency.name,
        contactName: contact.name,
        email: agency.email,
        phone: contact.phone,
        countryItemId: null,
        countryCode: null,
        countryOrRegion: '',
        sourceChannel: '',
        originalMessage: '',
        internalRemark: '',
        plannedDays: 1,
        nextFollowUpAt: null,
        lostReason: '',
      };
      if (previous?.data.agencyId === input.agencyId)
        snapshot = {
          ...previous.data,
          contactId: contact.id,
          contactName: contact.name,
          phone: contact.phone,
        };
    }
    let country = {
      id: snapshot!.countryItemId,
      code: snapshot!.countryCode,
      name: snapshot!.countryOrRegion,
    };
    if (country.id !== input.countryItemId) {
      const item = await requireDictionaryItem(
        manager,
        'country-region',
        input.countryItemId,
      );
      country = { id: item.id, code: item.code, name: item.name };
    }
    return {
      ...snapshot!,
      countryItemId: country.id,
      countryCode: country.code,
      countryOrRegion: country.name,
      sourceChannel: input.sourceChannel.trim(),
      originalMessage: input.originalMessage.trim(),
      internalRemark: input.internalRemark,
      plannedDays: input.plannedDays,
      nextFollowUpAt: input.nextFollowUpAt
        ? new Date(input.nextFollowUpAt).toISOString()
        : null,
      lostReason: input.status === 'lost' ? input.lostReason.trim() : '',
    };
  }
  async create(input: InquiryInput, actor: Actor) {
    this.permission(actor, 'inquiry:create');
    return this.db.transaction(async (manager) => {
      if (input.status && input.status !== 'new')
        invalid('New inquiry must be new');
      const businessUnit =
        actor.scope === 'headquarters' ? input.businessUnit : actor.scope;
      if (
        !businessUnit ||
        (input.businessUnit && input.businessUnit !== businessUnit)
      )
        invalid('Business unit required');
      let owner: UserEntity;
      if (input.isSeries) {
        if (businessUnit !== 'shengxu') invalid('系列询盘仅用于盛旭');
        const ownerId =
          actor.roles.includes('COORDINATOR') && actor.scope === 'shengxu'
            ? actor.id
            : input.ownerId;
        if (
          !ownerId ||
          (!actor.admin && input.ownerId && input.ownerId !== actor.id)
        )
          fail('INQUIRY_OWNER_INVALID', HttpStatus.BAD_REQUEST);
        owner = await this.owner(ownerId, actor, manager, businessUnit, true);
      } else {
        const agency = await manager.findOneBy(AgencyEntity, {
          id: input.agencyId,
        });
        if (
          !agency ||
          agency.status !== ResourceStatus.Enabled ||
          agency.businessUnit !== businessUnit ||
          !agency.coordinatorId ||
          (input.ownerId && input.ownerId !== agency.coordinatorId)
        )
          fail('INQUIRY_OWNER_INVALID', HttpStatus.BAD_REQUEST);
        owner = await this.owner(
          agency.coordinatorId,
          actor,
          manager,
          businessUnit,
          false,
          true,
        );
      }
      const row = await manager.save(
        InquiryEntity,
        Object.assign(new InquiryEntity(), {
          code: await nextBusinessCode(manager, 'INQ'),
          businessUnit,
          ownerId: owner.id,
          owner: owner.nickname,
          status: 'new',
          creator: actor.username,
          createdBy: actor.id,
          updatedBy: actor.id,
          data: await this.data(input, manager, undefined, businessUnit),
        }),
      );
      if (row.internalRemark.trim() || row.nextFollowUpAt)
        await appendFollowUp(
          manager,
          row.id,
          { remark: row.internalRemark, nextFollowUpAt: row.nextFollowUpAt },
          actor,
        );
      await this.log(
        manager,
        row,
        actor,
        'inquiry_created',
        undefined,
        diffChanges(undefined, row.data),
      );
      return this.inquiryResponse(row, actor);
    });
  }
  async update(id: string, input: UpdateInquiryDto, actor: Actor) {
    return this.db.transaction(async (manager) => {
      const row = await this.inquiry(id, actor, manager, true);
      this.writable(row, actor);
      await assertNoActiveTour(manager, 'standard', row.id, true);
      this.checkVersion(row.version, input.version);
      if (
        input.status &&
        input.status !== row.status &&
        input.status !== 'lost'
      )
        invalid('Invalid inquiry status transition');
      if (input.status === 'lost' && !input.lostReason.trim())
        invalid('Lost reason required');
      if ((input.isSeries ?? false) !== row.isSeries)
        invalid('询盘类型创建后不可切换');
      const nextData = await this.data(input, manager, row);
      if (
        (input.ownerId && input.ownerId !== row.ownerId) ||
        (input.businessUnit && input.businessUnit !== row.businessUnit)
      )
        fail('INQUIRY_OWNER_INVALID', HttpStatus.FORBIDDEN);
      const owner = { id: row.ownerId, nickname: row.owner };
      const nextStatus = input.status ?? row.status;
      const changes = diffChanges(
        {
          ...row.data,
          ownerId: row.ownerId,
          owner: row.owner,
          status: row.status,
        },
        {
          ...nextData,
          ownerId: owner.id,
          owner: owner.nickname,
          status: nextStatus,
        },
      );
      if (!changes.length) return this.inquiryResponse(row, actor);
      const followUpChanged =
        row.internalRemark !== nextData.internalRemark ||
        row.nextFollowUpAt !== nextData.nextFollowUpAt;
      row.data = nextData;
      row.status = nextStatus;
      row.ownerId = owner.id;
      row.owner = owner.nickname;
      row.updatedBy = actor.id;
      const saved = await manager.save(row);
      if (followUpChanged)
        await appendFollowUp(
          manager,
          row.id,
          { remark: row.internalRemark, nextFollowUpAt: row.nextFollowUpAt },
          actor,
          nextStatus !== 'lost',
        );
      if (nextStatus === 'lost') await cancelInquiryReminders(manager, row.id);
      await this.log(
        manager,
        row,
        actor,
        nextStatus === 'lost' ? 'inquiry_lost' : 'inquiry_updated',
        undefined,
        changes,
        { lostReason: row.data.lostReason },
      );
      return this.inquiryResponse(saved, actor);
    });
  }
  async delete(id: string, version: number, actor: Actor): Promise<void> {
    this.permission(actor, 'inquiry:delete');
    await this.db.transaction(async (manager) => {
      const row = await this.inquiry(id, actor, manager, true);
      if (!canDeleteInquiry(actor, row.ownerId, 'inquiry:delete'))
        fail('AUTH_FORBIDDEN', HttpStatus.FORBIDDEN);
      this.checkVersion(row.version, version);
      await assertNoActiveTour(manager, 'standard', row.id);
      await cancelInquiryReminders(manager, row.id);
      row.deletedAt = new Date();
      row.updatedBy = actor.id;
      await manager.save(row);
    });
  }
  async archive(id: string, version: number, actor: Actor) {
    if (!actor.admin) fail('AUTH_FORBIDDEN', HttpStatus.FORBIDDEN);
    return this.db.transaction(async (manager) => {
      const row = await this.inquiry(id, actor, manager, true);
      this.writable(row, actor);
      await assertNoActiveTour(manager, 'standard', row.id);
      this.checkVersion(row.version, version);
      const before = row.status;
      await cancelInquiryReminders(manager, row.id);
      row.status = 'archived';
      row.updatedBy = actor.id;
      await manager.save(row);
      await this.log(
        manager,
        row,
        actor,
        'inquiry_archived',
        undefined,
        diffChanges(before, row.status, 'status'),
      );
      return this.inquiryResponse(row, actor);
    });
  }
  async createContact(agencyId: string, input: ContactInput, actor: Actor) {
    this.permission(actor, 'inquiry:create');
    this.permission(actor, 'inquiry:update');
    if (!['headquarters', 'shengxu'].includes(actor.scope))
      fail('AUTH_FORBIDDEN', HttpStatus.FORBIDDEN);
    return this.db.transaction(async (manager) => {
      const inquiry = input.inquiryId
        ? await this.inquiry(input.inquiryId, actor, manager, true)
        : null;
      if (inquiry) this.writable(inquiry, actor);
      const agency = await manager.findOne(AgencyEntity, {
        where: { id: agencyId },
        lock: { mode: 'pessimistic_write' },
      });
      const retained = inquiry?.data.agencyId === agencyId;
      if (
        !agency ||
        agency.status !== ResourceStatus.Enabled ||
        (!retained &&
          actor.scope !== 'headquarters' &&
          agency.businessUnit !== actor.scope)
      )
        fail('INQUIRY_CONTACT_INVALID', HttpStatus.BAD_REQUEST);
      return this.agencies.createContact(
        agencyId,
        { name: input.name.trim(), phone: input.phone.trim() },
        actor.id,
        manager,
      );
    });
  }
  async itineraries(id: string, actor: Actor) {
    await this.inquiry(id, actor);
    const rows = await this.db.manager.find(ItineraryEntity, {
      where: { inquiryId: id },
      order: { updatedAt: 'DESC', id: 'DESC' },
    });
    for (const row of rows) await loadItineraryData(this.db.manager, row);
    return rows.map((row) => this.itineraryResponse(row));
  }
  private async pair(
    id: string,
    actor: Actor,
    manager = this.db.manager,
    lock = false,
  ) {
    const initial = await manager.findOneBy(ItineraryEntity, { id });
    if (!initial) fail('ITINERARY_NOT_FOUND', HttpStatus.NOT_FOUND);
    const inquiry = await this.inquiry(initial.inquiryId, actor, manager, lock);
    const itinerary = lock
      ? await manager.findOneOrFail(ItineraryEntity, {
          where: { id },
          lock: { mode: 'pessimistic_write' },
        })
      : initial;
    await loadItineraryData(manager, itinerary);
    return { inquiry, itinerary };
  }
  async itinerary(id: string, actor: Actor) {
    const { itinerary } = await this.pair(id, actor);
    return this.itineraryResponse(itinerary);
  }
  private async calculateQuote(
    data: ItineraryInput,
    manager = this.db.manager,
  ) {
    const items = data.dailyPlans.flatMap((day) => day.items);
    const restaurantIds = [
      ...new Set(
        items.flatMap((item) =>
          item.type === 'restaurant' && item.resourceId
            ? [item.resourceId]
            : [],
        ),
      ),
    ];
    const attractionIds = [
      ...new Set(
        items.flatMap((item) =>
          item.type === 'attraction' && item.resourceId
            ? [item.resourceId]
            : [],
        ),
      ),
    ];
    const [restaurants, attractions] = await Promise.all([
      restaurantIds.length
        ? manager.find(RestaurantEntity, {
            where: { id: In(restaurantIds) },
            select: { id: true, city: true },
          })
        : [],
      attractionIds.length
        ? manager.find(AttractionEntity, {
            where: { id: In(attractionIds) },
            select: { id: true, area: true },
          })
        : [],
    ]);
    const cities = new Map<string, string>();
    for (const restaurant of restaurants)
      if (restaurant.city.trim())
        cities.set(`restaurant:${restaurant.id}`, restaurant.city.trim());
    for (const attraction of attractions)
      if (attraction.area.trim())
        cities.set(`attraction:${attraction.id}`, attraction.area.trim());
    return calculateItineraryQuote(data, cities);
  }
  async quoteCalculation(id: string, actor: Actor) {
    const { itinerary } = await this.pair(id, actor);
    if (itinerary.status === 'quoted') {
      const quote = await this.db.manager.findOneByOrFail(
        ItineraryQuoteEntity,
        {
          itineraryId: id,
        },
      );
      return quote.snapshot.calculation;
    }
    return this.calculateQuote(itinerary.data);
  }
  async previewQuote(id: string, input: ItineraryInput, actor: Actor) {
    const { inquiry, itinerary } = await this.pair(id, actor);
    this.writable(inquiry, actor);
    if (itinerary.status !== 'draft')
      fail('ITINERARY_READ_ONLY', HttpStatus.CONFLICT);
    const data = await this.validation.normalize(
      this.db.manager,
      input,
      itinerary.data,
      inquiry.data.plannedDays ?? input.dailyPlans.length,
      false,
    );
    return this.calculateQuote(data);
  }
  private async planning(
    manager: EntityManager,
    inquiry: InquiryEntity,
    actor: Actor,
  ) {
    if (inquiry.status !== 'planning') {
      inquiry.status = 'planning';
      inquiry.updatedBy = actor.id;
      await manager.save(inquiry);
    }
  }
  async createItinerary(id: string, input: ItineraryInput, actor: Actor) {
    return this.db.transaction(async (manager) => {
      const inquiry = await this.inquiry(id, actor, manager, true);
      this.writable(inquiry, actor);
      await assertNoActiveTour(manager, 'standard', inquiry.id, true);
      const data = await this.validation.normalize(
        manager,
        input,
        undefined,
        inquiry.data.plannedDays ?? input.dailyPlans.length,
      );
      const row = await manager.save(
        ItineraryEntity,
        Object.assign(new ItineraryEntity(), {
          inquiryId: id,
          code: await nextBusinessCode(manager, 'ITI'),
          status: 'draft',
          creator: actor.username,
          data,
          title: data.title,
          startDate: data.startDate,
          paxTiers: data.paxTiers,
          childRate: data.childRate,
          childWithoutBedRate: data.childWithoutBedRate,
          createdBy: actor.id,
          updatedBy: actor.id,
        }),
      );
      await saveItineraryData(manager, row);
      await this.planning(manager, inquiry, actor);
      await this.log(
        manager,
        inquiry,
        actor,
        'itinerary_created',
        row,
        diffChanges(undefined, data),
        { creationMode: 'new' },
      );
      await recordPriceAdjustments(manager, row.id, undefined, data, actor);
      return this.itineraryResponse(row);
    });
  }
  async saveItinerary(id: string, input: UpdateItineraryDto, actor: Actor) {
    return this.db.transaction(async (manager) => {
      const { inquiry, itinerary } = await this.pair(id, actor, manager, true);
      this.writable(inquiry, actor);
      await assertNoActiveTour(manager, 'standard', inquiry.id, true);
      if (itinerary.status !== 'draft')
        fail('ITINERARY_READ_ONLY', HttpStatus.CONFLICT);
      this.checkVersion(itinerary.version, input.version, true);
      const body = { ...input };
      delete (body as Partial<UpdateItineraryDto>).version;
      const data = await this.validation.normalize(
        manager,
        body,
        itinerary.data,
        inquiry.data.plannedDays ?? input.dailyPlans.length,
      );
      const changes = contextualChanges(itinerary.data, data);
      if (!changes.length) return this.itineraryResponse(itinerary);
      await recordPriceAdjustments(
        manager,
        itinerary.id,
        itinerary.data,
        data,
        actor,
      );
      itinerary.data = data;
      // Detail-only edits must advance the parent optimistic-lock version.
      itinerary.version += 1;
      itinerary.updatedBy = actor.id;
      await manager.save(itinerary);
      await saveItineraryData(manager, itinerary);
      await this.log(
        manager,
        inquiry,
        actor,
        'itinerary_saved',
        itinerary,
        changes,
      );
      return this.itineraryResponse(itinerary);
    });
  }
  async copy(id: string, input: CopyItineraryDto, actor: Actor) {
    return this.db.transaction(async (manager) => {
      const { inquiry, itinerary } = await this.pair(id, actor, manager, true);
      this.writable(inquiry, actor);
      await assertNoActiveTour(manager, 'standard', inquiry.id, true);
      this.checkVersion(itinerary.version, input.version, true);
      const data = structuredClone(itinerary.data);
      data.title = input.title;
      const allDays = [
        ...data.dailyPlans,
        ...(data.deletedDays ?? []).map((entry) => entry.day),
      ];
      const ids = new Map(allDays.map((d) => [d.id, randomUUID()]));
      allDays.forEach((d) => {
        d.id = ids.get(d.id)!;
        d.items.forEach((i) => {
          i.id = randomUUID();
        });
      });
      data.vehiclePlans.forEach((p) =>
        p.arrangements.forEach((a) => {
          a.id = randomUUID();
        }),
      );
      data.quote.options.forEach((o) => {
        o.id = randomUUID();
      });
      data.quote.transportFees.forEach((f) => {
        f.id = randomUUID();
      });
      const row = await manager.save(
        ItineraryEntity,
        Object.assign(new ItineraryEntity(), {
          inquiryId: inquiry.id,
          code: await nextBusinessCode(manager, 'ITI'),
          status: 'draft',
          creator: actor.username,
          data,
          title: data.title,
          startDate: data.startDate,
          paxTiers: data.paxTiers,
          childRate: data.childRate,
          childWithoutBedRate: data.childWithoutBedRate,
          createdBy: actor.id,
          updatedBy: actor.id,
        }),
      );
      await saveItineraryData(manager, row);
      await this.planning(manager, inquiry, actor);
      await this.log(
        manager,
        inquiry,
        actor,
        'itinerary_created',
        row,
        diffChanges(undefined, data),
        {
          creationMode: 'copy',
          sourceItineraryId: itinerary.id,
          sourceCode: itinerary.code,
        },
      );
      return this.itineraryResponse(row);
    });
  }
  private async pdfSnapshot(
    inquiry: InquiryEntity,
    row: ItineraryEntity,
    manager: EntityManager,
  ): Promise<CurrentPdfData> {
    const generatedAt = new Date().toISOString();
    return {
      inquiry: this.inquiryResponse(inquiry),
      itinerary: this.itineraryResponse(row, generatedAt),
      inquiryVersion: inquiry.version,
      generatedAt,
      quoteCode: `${row.code}-V1`,
      quoteVersion: 1,
      calculation: await this.calculateQuote(row.data, manager),
      ...(inquiry.businessUnit === 'shengxu'
        ? {
            customerPresentation: await buildCustomerPresentation(
              manager,
              row.data,
              inquiry,
            ),
          }
        : {}),
    };
  }
  /** Records the first download click on a frozen quote; repeats keep the first time. */
  async recordDownload(id: string, actor: Actor) {
    this.permission(actor, 'itinerary:download');
    await this.pair(id, actor);
    const rows = await this.db.query<{ firstDownloadedAt: Date }[]>(
      `WITH updated AS (UPDATE itinerary_quotes SET first_downloaded_at = COALESCE(first_downloaded_at, now()),
       first_downloaded_by = COALESCE(first_downloaded_by, $2)
       WHERE itinerary_id = $1 RETURNING first_downloaded_at AS "firstDownloadedAt") SELECT * FROM updated`,
      [id, actor.id],
    );
    if (!rows[0]) fail('PDF_NOT_READY', HttpStatus.CONFLICT);
    return { firstDownloadedAt: rows[0].firstDownloadedAt };
  }
  async pdfData(id: string, actor: Actor, language: 'zh' | 'en' = 'zh') {
    return this.db.transaction(async (manager) => {
      const { inquiry, itinerary } = await this.pair(id, actor, manager, true);
      const original = await manager.findOneBy(ItineraryQuoteEntity, {
        itineraryId: id,
      });
      if (language === 'en' && inquiry.businessUnit !== 'shengxu')
        invalid('英文导出当前仅支持盛旭');
      if (original) return exportSnapshot(original.snapshot, language);
      this.writable(inquiry, actor);
      await assertNoActiveTour(manager, 'standard', inquiry.id, true);
      await this.validation.assertUniqueResources(manager, itinerary.data);
      this.validation.assertPdfReady(
        itinerary.data,
        inquiry.data.plannedDays ?? itinerary.data.dailyPlans.length,
      );
      return exportSnapshot(
        await this.pdfSnapshot(inquiry, itinerary, manager),
        language,
      );
    });
  }
  async confirmPdf(id: string, input: ConfirmPdfDto, actor: Actor) {
    this.permission(actor, 'itinerary:pdf');
    return this.db.transaction(async (manager) => {
      const { inquiry, itinerary } = await this.pair(id, actor, manager, true);
      const language = input.language ?? 'zh';
      if (language === 'en' && inquiry.businessUnit !== 'shengxu')
        invalid('英文导出当前仅支持盛旭');
      const original = await manager.findOneBy(ItineraryQuoteEntity, {
        itineraryId: id,
      });
      if (
        original &&
        original.sourceVersion === input.version &&
        original.snapshot.inquiryVersion === input.inquiryVersion
      )
        return exportSnapshot(original.snapshot, language);
      this.writable(inquiry, actor);
      await assertNoActiveTour(manager, 'standard', inquiry.id, true);
      this.checkVersion(itinerary.version, input.version, true);
      this.checkVersion(inquiry.version, input.inquiryVersion);
      if (itinerary.status !== 'draft')
        fail('ITINERARY_READ_ONLY', HttpStatus.CONFLICT);
      await this.validation.assertUniqueResources(manager, itinerary.data);
      this.validation.assertPdfReady(
        itinerary.data,
        inquiry.data.plannedDays ?? itinerary.data.dailyPlans.length,
      );
      const snapshot = await this.pdfSnapshot(inquiry, itinerary, manager);
      exportSnapshot(snapshot, language);
      const frozen = await manager.save(
        ItineraryQuoteEntity,
        manager.create(ItineraryQuoteEntity, {
          itineraryId: id,
          sourceVersion: itinerary.version,
          createdBy: actor.id,
          snapshot,
          quoteCode: snapshot.quoteCode,
          quoteVersion: snapshot.quoteVersion,
          inquiryId: inquiry.id,
          inquiryVersion: inquiry.version,
          dailyResourceCost: snapshot.calculation.dailyResourceCost,
          guideCost: snapshot.calculation.guideCost,
        }),
      );
      await saveFrozenDetails(manager, frozen.id, snapshot);
      itinerary.status = 'quoted';
      itinerary.updatedBy = actor.id;
      await manager.save(itinerary);
      inquiry.status = 'quoted';
      inquiry.updatedBy = actor.id;
      await manager.save(inquiry);
      await this.log(
        manager,
        inquiry,
        actor,
        'itinerary_pdf_generated',
        itinerary,
        [],
        { quoteCode: snapshot.quoteCode, quoteVersion: 1 },
      );
      return exportSnapshot(snapshot, language);
    });
  }
  async transfer(id: string, input: TransferInquiryDto, actor: Actor) {
    this.permission(actor, 'inquiry:transfer');
    return this.db.transaction(async (manager) => {
      const current = await this.inquiry(id, actor, manager);
      const owner = await this.owner(
        input.ownerId,
        actor,
        manager,
        current.businessUnit as BusinessUnit,
        true,
      );
      const row = await this.inquiry(id, actor, manager, true);
      await assertNoActiveTour(manager, 'standard', row.id, true);
      this.checkVersion(row.version, input.version);
      if (row.ownerId === owner.id || !input.reason.trim())
        invalid('Choose a new owner and enter transfer reason');
      const beforeId = row.ownerId;
      const beforeName = row.owner;
      row.ownerId = owner.id;
      row.owner = owner.nickname;
      row.updatedBy = actor.id;
      await manager.save(row);
      await manager.query(
        'INSERT INTO inquiry_transfers(inquiry_id,previous_owner_id,new_owner_id,previous_owner_name,new_owner_name,reason,operator_id,operator_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          id,
          beforeId,
          owner.id,
          beforeName,
          owner.nickname,
          input.reason.trim(),
          actor.id,
          actor.name,
        ],
      );
      await this.log(
        manager,
        row,
        actor,
        'inquiry_updated',
        undefined,
        diffChanges(
          { ownerId: beforeId, owner: beforeName },
          { ownerId: owner.id, owner: owner.nickname },
        ),
        { transferReason: input.reason.trim() },
      );
      return this.inquiryResponse(row, actor);
    });
  }
  async followUps(id: string, query: PaginationQueryDto, actor: Actor) {
    await this.inquiry(id, actor);
    const [count] = await this.db.query<{ total: number }[]>(
      'SELECT count(*)::int AS total FROM inquiry_follow_ups WHERE inquiry_id=$1',
      [id],
    );
    const list = await this.db.query<Record<string, unknown>[]>(
      `SELECT f.id,f.inquiry_id AS "inquiryId",f.remark,f.next_follow_up_at AS "nextFollowUpAt",f.reminder_days AS "reminderDays",
      f.followed_at AS "followedAt",f.followed_by AS "followedBy",f.followed_by_name AS "followedByName",f.legacy,
      r.id AS "reminderId",r.due_at AS "reminderAt",r.status AS "reminderStatus",r.recipient_id AS "recipientId",r.sent_at AS "sentAt",r.error_code AS "reminderError",r.delivery_unknown AS "deliveryUnknown"
      FROM inquiry_follow_ups f LEFT JOIN inquiry_follow_up_reminders r ON r.follow_up_id=f.id
      WHERE f.inquiry_id=$1 ORDER BY f.followed_at DESC NULLS LAST,f.id DESC LIMIT $2 OFFSET $3`,
      [id, query.pageSize, (query.page - 1) * query.pageSize],
    );
    return {
      list,
      total: count.total,
      page: query.page,
      pageSize: query.pageSize,
      delivery: await this.reminders.availability(this.db.manager, id),
    };
  }
  async addFollowUp(id: string, input: FollowUpInput, actor: Actor) {
    this.permission(actor, 'inquiry:update');
    return this.db.transaction(async (manager) => {
      const inquiry = await this.inquiry(id, actor, manager, true);
      const next = input.nextFollowUpAt
        ? new Date(input.nextFollowUpAt).toISOString()
        : null;
      const [existing] = await manager.query<
        {
          id: string;
          remark: string;
          next_follow_up_at: Date | null;
          reminder_days: number | null;
        }[]
      >(
        'SELECT * FROM inquiry_follow_ups WHERE inquiry_id=$1 AND request_id=$2',
        [id, input.requestId],
      );
      if (existing) {
        if (
          existing.remark !== input.remark ||
          (existing.next_follow_up_at?.toISOString() ?? null) !== next ||
          existing.reminder_days !== (input.reminderDays ?? null)
        )
          invalid('同一请求标识不能用于不同跟进内容');
        return {
          id: existing.id,
          inquiryVersion: inquiry.version,
          delivery: await this.reminders.availability(manager, id),
        };
      }
      this.writable(inquiry, actor);
      this.checkVersion(inquiry.version, input.version);
      await assertNoActiveTour(manager, 'standard', id, true);
      const followUpId = await appendFollowUp(
        manager,
        id,
        { ...input, nextFollowUpAt: next },
        actor,
      );
      const before = {
        internalRemark: inquiry.internalRemark,
        nextFollowUpAt: inquiry.nextFollowUpAt,
      };
      inquiry.internalRemark = input.remark;
      inquiry.nextFollowUpAt = next;
      inquiry.updatedBy = actor.id;
      await manager.save(inquiry);
      await this.log(
        manager,
        inquiry,
        actor,
        'inquiry_updated',
        undefined,
        diffChanges(before, {
          internalRemark: input.remark,
          nextFollowUpAt: next,
        }),
        { followUpId },
      );
      return {
        id: followUpId,
        inquiryVersion: inquiry.version,
        delivery: await this.reminders.availability(manager, id),
      };
    });
  }
  async transfers(id: string, actor: Actor) {
    await this.inquiry(id, actor);
    return this.db.manager.query<Record<string, unknown>[]>(
      'SELECT id, inquiry_id AS "inquiryId", previous_owner_id AS "previousOwnerId",new_owner_id AS "newOwnerId",previous_owner_name AS "previousOwnerName",new_owner_name AS "newOwnerName",reason,operator_id AS "operatorId",operator_name AS "operatorName",occurred_at AS "occurredAt" FROM inquiry_transfers WHERE inquiry_id=$1 ORDER BY occurred_at DESC,id DESC',
      [id],
    );
  }
  async priceAdjustments(id: string, actor: Actor) {
    await this.pair(id, actor);
    return this.db.manager.query<Record<string, unknown>[]>(
      'SELECT id,itinerary_id AS "itineraryId",item_key AS "itemKey",item_type AS "itemType",item_name AS "itemName",reference_basis AS "referenceBasis",reference_price AS "referencePrice",before_price AS "beforePrice",after_price AS "afterPrice",reason,action,operator_id AS "operatorId",operator_name AS "operatorName",occurred_at AS "occurredAt" FROM itinerary_price_adjustments WHERE itinerary_id=$1 ORDER BY occurred_at DESC,id DESC',
      [id],
    );
  }
  private async log(
    manager: EntityManager,
    inquiry: InquiryEntity,
    actor: Actor,
    action: LogAction,
    itinerary?: ItineraryEntity,
    changes: FieldChange[] = [],
    metadata: Record<string, unknown> = {},
  ) {
    await manager.save(
      InquiryLogEntity,
      manager.create(InquiryLogEntity, {
        inquiryId: inquiry.id,
        inquiryCode: inquiry.code,
        action,
        operatorId: actor.id,
        operatorUsername: actor.username,
        operatorName: actor.name,
        roles: actor.roles,
        targetType: itinerary ? 'itinerary' : 'inquiry',
        targetId: itinerary?.id ?? inquiry.id,
        targetCode: itinerary?.code ?? inquiry.code,
        summary: itinerary?.data.title ?? '',
        metadata,
        changes,
        ip: actor.ip,
        requestId: actor.requestId,
      }),
    );
  }
  private logQuery(query: LogQuery, actor: Actor) {
    if (query.from && query.to && query.from > query.to)
      invalid('Invalid report date range');
    const qb = this.db.manager
      .createQueryBuilder(InquiryLogEntity, 'l')
      .innerJoin(InquiryEntity, 'i', 'i.id = l.inquiryId');
    this.scopeInquiryQuery(qb, actor);
    if (query.businessUnit) {
      if (actor.scope !== 'headquarters' && query.businessUnit !== actor.scope)
        fail('AUTH_FORBIDDEN', HttpStatus.FORBIDDEN);
      qb.andWhere('i.businessUnit = :filterBusinessUnit', {
        filterBusinessUnit: query.businessUnit,
      });
    }
    if (query.inquiryId)
      qb.andWhere('l.inquiryId = :inquiryId', { inquiryId: query.inquiryId });
    if (query.inquiryCode?.trim())
      qb.andWhere('i.code ILIKE :inquiryCode', {
        inquiryCode: `%${query.inquiryCode.trim()}%`,
      });
    if (query.operatorId)
      qb.andWhere('l.operatorId = :operatorId', {
        operatorId: query.operatorId,
      });
    if (query.action)
      qb.andWhere('l.action = :action', { action: query.action });
    if (query.from)
      qb.andWhere('l.occurredAt >= :from', {
        from: `${query.from}T00:00:00+08:00`,
      });
    if (query.to)
      qb.andWhere(
        "l.occurredAt < CAST(:to AS timestamptz) + INTERVAL '1 day'",
        { to: `${query.to}T00:00:00+08:00` },
      );
    return qb;
  }
  async logs(query: LogQuery, actor: Actor) {
    if (query.inquiryId) await this.inquiry(query.inquiryId, actor);
    const [rows, total] = await this.logQuery(query, actor)
      .orderBy('l.occurredAt', 'DESC')
      .addOrderBy('l.id', 'DESC')
      .skip((query.page - 1) * query.pageSize)
      .take(query.pageSize)
      .getManyAndCount();
    return {
      list: rows.map((row) => ({
        id: row.id,
        inquiryId: row.inquiryId,
        inquiryCode: row.inquiryCode,
        action: row.action,
        occurredAt: row.occurredAt.toISOString(),
        operatorId: row.operatorId,
        operatorUsername: row.operatorUsername,
        operatorName: row.operatorName,
        targetType: row.targetType,
        targetId: row.targetId,
        targetCode: row.targetCode,
        summary: row.summary,
        metadata: row.metadata,
        changes: row.changes,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }
  async report(query: LogQuery, actor: Actor) {
    if (query.inquiryId) await this.inquiry(query.inquiryId, actor);
    const qb = this.logQuery(query, actor);
    const totals = await qb
      .clone()
      .select('COUNT(*)', 'totalOperations')
      .addSelect('COUNT(DISTINCT l.inquiryId)', 'inquiryCount')
      .addSelect('COUNT(DISTINCT l.operatorId)', 'operatorCount')
      .addSelect(
        'COALESCE(SUM(jsonb_array_length(l.changes)),0)',
        'changedFields',
      )
      .getRawOne<Record<string, string>>();
    const counts = await qb
      .clone()
      .select('l.action', 'action')
      .addSelect('COUNT(*)', 'count')
      .groupBy('l.action')
      .getRawMany<{ action: LogAction; count: string }>();
    return {
      totalOperations: Number(totals?.totalOperations ?? 0),
      inquiryCount: Number(totals?.inquiryCount ?? 0),
      operatorCount: Number(totals?.operatorCount ?? 0),
      changedFields: Number(totals?.changedFields ?? 0),
      byAction: ACTIONS.map((action) => ({
        action,
        count: Number(counts.find((c) => c.action === action)?.count ?? 0),
      })),
    };
  }
  async operators(actor: Actor) {
    return this.logQuery(new LogQuery(), actor)
      .select('l.operatorId', 'id')
      .addSelect('l.operatorName', 'name')
      .addSelect('l.operatorUsername', 'username')
      .distinctOn(['l.operatorId'])
      .orderBy('l.operatorId')
      .addOrderBy('l.occurredAt', 'DESC')
      .getRawMany<{ id: string; name: string; username: string }>();
  }
}
