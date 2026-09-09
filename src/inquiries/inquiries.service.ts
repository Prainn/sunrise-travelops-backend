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
  UpdateItineraryDto,
} from './inquiry.dto';
import {
  FieldChange,
  InquiryEntity,
  InquiryLogEntity,
  ItineraryEntity,
  ItineraryQuoteEntity,
  PdfData,
} from './inquiry.entity';
import { diffChanges, contextualChanges } from './changes';
import { dateAt, invalid, ItineraryValidation } from './itinerary-validation';
import { calculateItineraryQuote } from './quote-pricing';
import { sumMoney } from './money';
interface Actor {
  id: string;
  username: string;
  name: string;
  roles: string[];
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
  async actor(user: AuthenticatedUser, request: Request): Promise<Actor> {
    const record = await this.db.manager.findOneOrFail(UserEntity, {
      where: { id: user.id },
      relations: { roles: true },
    });
    const roles = record.roles.filter((r) => r.isEnabled).map((r) => r.code);
    return {
      id: user.id,
      username: user.username,
      name: record.nickname,
      roles,
      admin: roles.some((r) => ['ROOT', 'ADMIN'].includes(r)),
      ip: request.ip ?? '',
      requestId: String((request as Request & { id?: string }).id ?? ''),
    };
  }
  private queryInquiries(actor: Actor, manager = this.db.manager) {
    const query = manager.createQueryBuilder(InquiryEntity, 'i');
    if (!actor.admin)
      query.andWhere('i.ownerId = :actorId', { actorId: actor.id });
    return query;
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
  private writable(inquiry: InquiryEntity) {
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
    if (query.code?.trim())
      qb.andWhere('LOWER(i.code) = LOWER(:code)', { code: query.code.trim() });
    if (query.status)
      qb.andWhere('i.status = :status', { status: query.status });
    if (query.ownerId)
      qb.andWhere('i.ownerId = :ownerId', { ownerId: query.ownerId });
    if (query.sourceChannel)
      qb.andWhere("i.data ->> 'sourceChannel' = :source", {
        source: query.sourceChannel,
      });
    if (query.keyword?.trim())
      qb.andWhere(
        "(i.code ILIKE :keyword OR i.data ->> 'agencyName' ILIKE :keyword OR i.data ->> 'contactName' ILIKE :keyword OR i.data ->> 'email' ILIKE :keyword OR i.data ->> 'phone' ILIKE :keyword)",
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
  async owners(actor: Actor) {
    const qb = this.db.manager
      .createQueryBuilder(UserEntity, 'u')
      .innerJoin('u.roles', 'r')
      .where('u.status = :status', { status: UserStatus.Enabled });
    if (actor.admin)
      qb.andWhere(
        "((r.code = 'COORDINATOR' AND r.isEnabled = true) OR u.id = :id)",
        { id: actor.id },
      );
    else qb.andWhere('u.id = :id', { id: actor.id });
    return (await qb.orderBy('u.nickname', 'ASC').getMany()).map((u) => ({
      id: u.id,
      name: u.nickname,
      username: u.username,
    }));
  }
  private async owner(id: string, actor: Actor, manager: EntityManager) {
    if (!actor.admin && id !== actor.id)
      fail('INQUIRY_OWNER_INVALID', HttpStatus.FORBIDDEN);
    const user = await manager.findOne(UserEntity, {
      where: { id, status: UserStatus.Enabled },
      relations: { roles: true },
    });
    if (
      !user ||
      !user.roles.some(
        (r) => r.isEnabled && ['COORDINATOR', 'ROOT', 'ADMIN'].includes(r.code),
      )
    )
      fail('INQUIRY_OWNER_INVALID', HttpStatus.BAD_REQUEST);
    return user;
  }
  private async data(
    input: InquiryInput,
    manager: EntityManager,
    previous?: InquiryEntity,
  ) {
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
    return this.db.transaction(async (manager) => {
      if (input.status && input.status !== 'new')
        invalid('New inquiry must be new');
      const owner = await this.owner(input.ownerId ?? actor.id, actor, manager);
      const row = await manager.save(
        InquiryEntity,
        manager.create(InquiryEntity, {
          code: await nextBusinessCode(manager, 'INQ'),
          ownerId: owner.id,
          owner: owner.nickname,
          status: 'new',
          creator: actor.username,
          createdBy: actor.id,
          updatedBy: actor.id,
          data: await this.data(input, manager),
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
      this.writable(row);
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
      const ownerId = input.ownerId ?? row.ownerId;
      const owner =
        ownerId === row.ownerId
          ? { id: row.ownerId, nickname: row.owner }
          : await this.owner(ownerId, actor, manager);
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
      this.writable(row);
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
    return this.agencies.createContact(
      agencyId,
      { name: input.name.trim(), phone: input.phone.trim() },
      actor.id,
    );
  }
  async itineraries(id: string, actor: Actor) {
    await this.inquiry(id, actor);
    const rows = await this.db.manager.find(ItineraryEntity, {
      where: { inquiryId: id },
      order: { updatedAt: 'DESC', id: 'DESC' },
    });
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
    return { inquiry, itinerary };
  }
  async itinerary(id: string, actor: Actor) {
    const { itinerary } = await this.pair(id, actor);
    return this.itineraryResponse(itinerary);
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
      this.writable(inquiry);
      const data = await this.validation.normalize(manager, input);
      const row = await manager.save(
        ItineraryEntity,
        manager.create(ItineraryEntity, {
          inquiryId: id,
          code: await nextBusinessCode(manager, 'ITI'),
          status: 'draft',
          creator: actor.username,
          data,
          createdBy: actor.id,
          updatedBy: actor.id,
        }),
      );
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
      return this.itineraryResponse(row);
    });
  }
  async saveItinerary(id: string, input: UpdateItineraryDto, actor: Actor) {
    return this.db.transaction(async (manager) => {
      const { inquiry, itinerary } = await this.pair(id, actor, manager, true);
      this.writable(inquiry);
      if (itinerary.status !== 'draft')
        fail('ITINERARY_READ_ONLY', HttpStatus.CONFLICT);
      this.checkVersion(itinerary.version, input.version, true);
      const body = { ...input };
      delete (body as Partial<UpdateItineraryDto>).version;
      const data = await this.validation.normalize(
        manager,
        body,
        itinerary.data,
      );
      const changes = contextualChanges(itinerary.data, data);
      if (!changes.length) return this.itineraryResponse(itinerary);
      itinerary.data = data;
      itinerary.updatedBy = actor.id;
      await manager.save(itinerary);
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
      this.writable(inquiry);
      this.checkVersion(itinerary.version, input.version, true);
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
          a.dayIds = a.dayIds.map((id) => ids.get(id)!);
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
        manager.create(ItineraryEntity, {
          inquiryId: inquiry.id,
          code: await nextBusinessCode(manager, 'ITI'),
          status: 'draft',
          creator: actor.username,
          data,
          createdBy: actor.id,
          updatedBy: actor.id,
        }),
      );
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
      calculation: calculateItineraryQuote(
        row.data,
        sumMoney(
          row.data.dailyPlans.flatMap((d) => d.items.map((i) => i.totalCost)),
        ),
      ),
    };
  }
  async pdfData(id: string, actor: Actor) {
    return this.db.transaction(async (manager) => {
      const { inquiry, itinerary } = await this.pair(id, actor, manager, true);
      const original = await manager.findOneBy(ItineraryQuoteEntity, {
        itineraryId: id,
      });
      if (original) return original.snapshot;
      this.writable(inquiry);
      this.validation.assertPdfReady(itinerary.data);
      return this.pdfSnapshot(inquiry, itinerary);
    });
  }
  async confirmPdf(id: string, input: ConfirmPdfDto, actor: Actor) {
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
      this.writable(inquiry);
      this.checkVersion(itinerary.version, input.version, true);
      this.checkVersion(inquiry.version, input.inquiryVersion);
      if (itinerary.status !== 'draft')
        fail('ITINERARY_READ_ONLY', HttpStatus.CONFLICT);
      this.validation.assertPdfReady(itinerary.data);
      const snapshot = this.pdfSnapshot(inquiry, itinerary);
      await manager.save(
        ItineraryQuoteEntity,
        manager.create(ItineraryQuoteEntity, {
          itineraryId: id,
          sourceVersion: itinerary.version,
          createdBy: actor.id,
          snapshot,
        }),
      );
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
    if (!actor.admin)
      qb.andWhere('i.ownerId = :actorId', { actorId: actor.id });
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
