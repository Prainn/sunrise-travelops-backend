import {
  UserIdentityEntity,
  BusinessUnit,
  libraryFor,
} from '../users/user-identity.entity';
import { withResourceScope } from '../resources/common/resource-scope';
import { saveItineraryData, loadItineraryData } from './structured-itinerary';
import { recordPriceAdjustments } from './price-adjustments';
import { saveFrozenDetails } from './structured-quotes';
import { nextBusinessCode } from '../common/business-code';
import { ResourceStatus } from '../resources/common/resource.constants';
import { HttpStatus, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
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
  CurrentPdfData as PdfData,
} from './inquiry.entity';
import { diffChanges, contextualChanges } from './changes';
import {
  assertItineraryLibrary,
  dateAt,
  invalid,
  ItineraryValidation,
} from './itinerary-validation';
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
  ) {}
  actor(user: AuthenticatedUser, request: Request): Promise<Actor> {
    return Promise.resolve({
      ...user,
      name: user.nickname,
      admin:
        user.roles.includes('ROOT') || user.roles.includes('BUSINESS_MANAGER'),
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
  private inquiryResponse(row: InquiryEntity) {
    return {
      ...row.data,
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
      endDate: dateAt(row.data.startDate, row.data.dailyPlans.length - 1),
      quoteGeneratedAt: generatedAt,
    };
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
    return {
      list: rows.map((row) => this.inquiryResponse(row)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }
  async detail(id: string, actor: Actor) {
    return this.inquiryResponse(await this.inquiry(id, actor));
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
    const unchanged =
      previous?.data.agencyId === input.agencyId &&
      previous.data.contactId === input.contactId;
    let snapshot = previous?.data;
    if (!unchanged) {
      const agency = await manager.findOneBy(AgencyEntity, {
        id: input.agencyId,
        library: libraryFor(
          businessUnit ?? (previous!.businessUnit as BusinessUnit),
        ),
      });
      const contact = await manager.findOneBy(AgencyContactEntity, {
        id: input.contactId,
        agencyId: input.agencyId,
      });
      if (!agency || agency.status !== ResourceStatus.Enabled || !contact)
        fail('INQUIRY_CONTACT_INVALID', HttpStatus.BAD_REQUEST);
      snapshot = {
        agencyId: agency.id,
        contactId: contact.id,
        agencyCode: agency.code,
        agencyName: agency.name,
        contactName: contact.name,
        email: agency.email,
        phone: contact.phone,
        countryOrRegion: agency.countryOrRegion,
        sourceChannel: '',
        originalMessage: '',
        internalRemark: '',
        plannedDays: 1,
        nextFollowUpAt: null,
        lostReason: '',
      };
    }
    return {
      ...snapshot!,
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
      const agency = await manager.findOneBy(AgencyEntity, {
        id: input.agencyId,
        library: libraryFor(businessUnit),
      });
      if (
        !agency ||
        agency.status !== ResourceStatus.Enabled ||
        agency.businessUnit !== businessUnit ||
        !agency.coordinatorId ||
        (input.ownerId && input.ownerId !== agency.coordinatorId)
      )
        fail('INQUIRY_OWNER_INVALID', HttpStatus.BAD_REQUEST);
      const owner = await this.owner(
        agency.coordinatorId,
        actor,
        manager,
        businessUnit,
        false,
        true,
      );
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
      await this.log(
        manager,
        row,
        actor,
        'inquiry_created',
        undefined,
        diffChanges(undefined, row.data),
      );
      return this.inquiryResponse(row);
    });
  }
  async update(id: string, input: UpdateInquiryDto, actor: Actor) {
    return this.db.transaction(async (manager) => {
      const row = await this.inquiry(id, actor, manager, true);
      this.writable(row, actor);
      this.checkVersion(row.version, input.version);
      if (
        input.status &&
        input.status !== row.status &&
        input.status !== 'lost'
      )
        invalid('Invalid inquiry status transition');
      if (input.status === 'lost' && !input.lostReason.trim())
        invalid('Lost reason required');
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
      if (!changes.length) return this.inquiryResponse(row);
      row.data = nextData;
      row.status = nextStatus;
      row.ownerId = owner.id;
      row.owner = owner.nickname;
      row.updatedBy = actor.id;
      const saved = await manager.save(row);
      await this.log(
        manager,
        row,
        actor,
        nextStatus === 'lost' ? 'inquiry_lost' : 'inquiry_updated',
        undefined,
        changes,
        { lostReason: row.data.lostReason },
      );
      return this.inquiryResponse(saved);
    });
  }
  async archive(id: string, version: number, actor: Actor) {
    if (!actor.admin) fail('AUTH_FORBIDDEN', HttpStatus.FORBIDDEN);
    return this.db.transaction(async (manager) => {
      const row = await this.inquiry(id, actor, manager, true);
      this.writable(row, actor);
      this.checkVersion(row.version, version);
      const before = row.status;
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
      return this.inquiryResponse(row);
    });
  }
  async createContact(agencyId: string, input: ContactInput, actor: Actor) {
    this.permission(actor, 'inquiry:update');
    return withResourceScope(actor, null, () =>
      this.agencies.createContact(
        agencyId,
        { name: input.name.trim(), phone: input.phone.trim() },
        actor.id,
      ),
    );
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
  private calculateQuote(data: ItineraryInput) {
    return calculateItineraryQuote(data);
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
      inquiry.data.plannedDays,
      libraryFor(inquiry.businessUnit as BusinessUnit),
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
      const data = await this.validation.normalize(
        manager,
        input,
        undefined,
        inquiry.data.plannedDays,
        libraryFor(inquiry.businessUnit as BusinessUnit),
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
      if (itinerary.status !== 'draft')
        fail('ITINERARY_READ_ONLY', HttpStatus.CONFLICT);
      this.checkVersion(itinerary.version, input.version, true);
      const body = { ...input };
      delete (body as Partial<UpdateItineraryDto>).version;
      const data = await this.validation.normalize(
        manager,
        body,
        itinerary.data,
        inquiry.data.plannedDays,
        libraryFor(inquiry.businessUnit as BusinessUnit),
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
      this.checkVersion(itinerary.version, input.version, true);
      await assertItineraryLibrary(
        manager,
        itinerary.data,
        libraryFor(inquiry.businessUnit as BusinessUnit),
      );
      const data = structuredClone(itinerary.data);
      data.title = input.title;
      const ids = new Map(data.dailyPlans.map((d) => [d.id, randomUUID()]));
      data.dailyPlans.forEach((d) => {
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
  private pdfSnapshot(inquiry: InquiryEntity, row: ItineraryEntity): PdfData {
    const generatedAt = new Date().toISOString();
    return {
      inquiry: this.inquiryResponse(inquiry),
      itinerary: this.itineraryResponse(row, generatedAt),
      inquiryVersion: inquiry.version,
      generatedAt,
      quoteCode: `${row.code}-V1`,
      quoteVersion: 1,
      calculation: this.calculateQuote(row.data),
    };
  }
  async pdfData(id: string, actor: Actor) {
    return this.db.transaction(async (manager) => {
      const { inquiry, itinerary } = await this.pair(id, actor, manager, true);
      const original = await manager.findOneBy(ItineraryQuoteEntity, {
        itineraryId: id,
      });
      if (original) return original.snapshot;
      this.writable(inquiry, actor);
      await this.validation.assertUniqueResources(manager, itinerary.data);
      this.validation.assertPdfReady(itinerary.data, inquiry.data.plannedDays);
      return this.pdfSnapshot(inquiry, itinerary);
    });
  }
  async confirmPdf(id: string, input: ConfirmPdfDto, actor: Actor) {
    this.permission(actor, 'itinerary:pdf');
    return this.db.transaction(async (manager) => {
      const { inquiry, itinerary } = await this.pair(id, actor, manager, true);
      const original = await manager.findOneBy(ItineraryQuoteEntity, {
        itineraryId: id,
      });
      if (
        original &&
        original.sourceVersion === input.version &&
        original.snapshot.inquiryVersion === input.inquiryVersion
      )
        return original.snapshot;
      this.writable(inquiry, actor);
      this.checkVersion(itinerary.version, input.version, true);
      this.checkVersion(inquiry.version, input.inquiryVersion);
      if (itinerary.status !== 'draft')
        fail('ITINERARY_READ_ONLY', HttpStatus.CONFLICT);
      await this.validation.assertUniqueResources(manager, itinerary.data);
      this.validation.assertPdfReady(itinerary.data, inquiry.data.plannedDays);
      await assertItineraryLibrary(
        manager,
        itinerary.data,
        libraryFor(inquiry.businessUnit as BusinessUnit),
      );
      const snapshot = this.pdfSnapshot(inquiry, itinerary);
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
          hotelGuestCount: null,
          hotelRoomCount: null,
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
      return snapshot;
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
      return this.inquiryResponse(row);
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
