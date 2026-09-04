import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Not, Repository } from 'typeorm';
import { PageResult } from '../../common/types/page-result';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ErrorCode } from '../../common/constants/error-code';
import { AgencyContactEntity, AgencyEntity } from './agency.entity';
import {
  AgencyContactResponse,
  AgencyDetailResponse,
  AgencyListItemResponse,
  AgencyQueryDto,
  CreateAgencyContactDto,
  CreateAgencyDto,
  UpdateAgencyContactDto,
  UpdateAgencyDto,
} from './dto/agency.dto';
import {
  actualKeyword,
  actualPage,
  auditResponse,
} from '../common/resource.dto';
import {
  assertAllFound,
  assertMatchingId,
  assertVersion,
} from '../common/resource-errors';
import {
  ensureCodeAvailable,
  requireResource,
  requireResourceForUpdate,
  requireResources,
} from '../common/resource-service.helpers';

@Injectable()
export class AgenciesService {
  constructor(
    @InjectRepository(AgencyEntity)
    private readonly agencies: Repository<AgencyEntity>,
    @InjectRepository(AgencyContactEntity)
    private readonly contacts: Repository<AgencyContactEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async list(
    query: AgencyQueryDto,
  ): Promise<PageResult<AgencyListItemResponse>> {
    const page = actualPage(query);
    const builder = this.agencies
      .createQueryBuilder('agency')
      .loadRelationCountAndMap('agency.contactCount', 'agency.contacts')
      .orderBy('agency.createdAt', 'DESC')
      .addOrderBy('agency.id', 'ASC')
      .skip((page - 1) * query.pageSize)
      .take(query.pageSize);
    const keyword = actualKeyword(query);
    if (keyword)
      builder.andWhere(
        '(agency.code ILIKE :keyword OR agency.name ILIKE :keyword OR agency.city ILIKE :keyword OR agency.countryOrRegion ILIKE :keyword OR agency.email ILIKE :keyword)',
        { keyword: `%${keyword}%` },
      );
    if (query.status)
      builder.andWhere('agency.status = :status', { status: query.status });
    const [entities, total] = await builder.getManyAndCount();
    return {
      list: entities.map((entity) => this.toListResponse(entity)),
      total,
      page,
      pageSize: query.pageSize,
    };
  }

  async get(id: string): Promise<AgencyDetailResponse> {
    const entity = await this.agencies.findOne({
      where: { id },
      relations: { contacts: true },
    });
    if (!entity)
      throw new BusinessException({
        code: ErrorCode.AGENCY_NOT_FOUND,
        message: 'Agency was not found',
        status: HttpStatus.NOT_FOUND,
      });
    return {
      ...this.toListResponse(entity),
      contactCount: entity.contacts.length,
      contacts: entity.contacts.map((item) => this.toContactResponse(item)),
    };
  }

  async create(
    input: CreateAgencyDto,
    actorId: string,
  ): Promise<AgencyDetailResponse> {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(AgencyEntity);
      await ensureCodeAvailable(repository, input.code);
      const entity = repository.create({
        ...input,
        contacts: [],
        createdBy: actorId,
        updatedBy: actorId,
      });
      return this.getResponse(await repository.save(entity), []);
    });
  }

  async update(
    id: string,
    input: UpdateAgencyDto,
    actorId: string,
  ): Promise<AgencyDetailResponse> {
    assertMatchingId(input.id, id);
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(AgencyEntity);
      const entity = await requireResourceForUpdate(
        repository,
        id,
        ErrorCode.AGENCY_NOT_FOUND,
      );
      assertVersion(entity.version, input.version);
      await ensureCodeAvailable(repository, input.code, id);
      Object.assign(entity, input, { id, updatedBy: actorId });
      const saved = await repository.save(entity);
      const contacts = await manager
        .getRepository(AgencyContactEntity)
        .findBy({ agencyId: id });
      return this.getResponse(saved, contacts);
    });
  }

  async delete(ids: string[], actorId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(AgencyEntity);
      const entities = await requireResources(
        repository,
        ids,
        ErrorCode.AGENCY_NOT_FOUND,
      );
      const uniqueIds = entities.map((entity) => entity.id);
      await manager
        .getRepository(AgencyContactEntity)
        .createQueryBuilder()
        .update()
        .set({ updatedBy: actorId })
        .where('agency_id IN (:...ids)', { ids: uniqueIds })
        .andWhere('deleted_at IS NULL')
        .execute();
      await manager
        .getRepository(AgencyContactEntity)
        .softDelete({ agencyId: In(uniqueIds) });
      await repository
        .createQueryBuilder()
        .update()
        .set({ updatedBy: actorId })
        .whereInIds(uniqueIds)
        .execute();
      await repository.softDelete(uniqueIds);
    });
  }

  async listContacts(agencyId: string): Promise<AgencyContactResponse[]> {
    await requireResource(this.agencies, agencyId, ErrorCode.AGENCY_NOT_FOUND);
    return (
      await this.contacts.find({
        where: { agencyId },
        order: { createdAt: 'ASC', id: 'ASC' },
      })
    ).map((item) => this.toContactResponse(item));
  }

  async createContact(
    agencyId: string,
    input: CreateAgencyContactDto,
    actorId: string,
  ): Promise<AgencyContactResponse> {
    return this.dataSource.transaction(async (manager) => {
      await requireResource(
        manager.getRepository(AgencyEntity),
        agencyId,
        ErrorCode.AGENCY_NOT_FOUND,
      );
      const repository = manager.getRepository(AgencyContactEntity);
      const nameKey = input.name.toLowerCase();
      if (
        await repository.findOne({
          where: { agencyId, nameKey },
        })
      )
        throw new BusinessException({
          code: ErrorCode.AGENCY_CONTACT_NAME_EXISTS,
          message: 'Contact name already exists for this agency',
          status: HttpStatus.CONFLICT,
        });
      return this.toContactResponse(
        await repository.save(
          repository.create({
            ...input,
            agencyId,
            nameKey,
            createdBy: actorId,
            updatedBy: actorId,
          }),
        ),
      );
    });
  }

  async updateContact(
    agencyId: string,
    contactId: string,
    input: UpdateAgencyContactDto,
    actorId: string,
  ): Promise<AgencyContactResponse> {
    assertMatchingId(input.id, contactId);
    return this.dataSource.transaction(async (manager) => {
      await requireResource(
        manager.getRepository(AgencyEntity),
        agencyId,
        ErrorCode.AGENCY_NOT_FOUND,
      );
      const repository = manager.getRepository(AgencyContactEntity);
      const entity = await repository.findOne({
        where: { id: contactId, agencyId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!entity)
        throw new BusinessException({
          code: ErrorCode.AGENCY_CONTACT_NOT_FOUND,
          message: 'Contact was not found for this agency',
          status: HttpStatus.NOT_FOUND,
        });
      assertVersion(entity.version, input.version);
      const nameKey = input.name.toLowerCase();
      if (
        await repository.findOne({
          where: { agencyId, nameKey, id: Not(contactId) },
        })
      )
        throw new BusinessException({
          code: ErrorCode.AGENCY_CONTACT_NAME_EXISTS,
          message: 'Contact name already exists for this agency',
          status: HttpStatus.CONFLICT,
        });
      Object.assign(entity, input, {
        id: contactId,
        agencyId,
        nameKey,
        updatedBy: actorId,
      });
      return this.toContactResponse(await repository.save(entity));
    });
  }

  async deleteContacts(
    agencyId: string,
    ids: string[],
    actorId: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await requireResource(
        manager.getRepository(AgencyEntity),
        agencyId,
        ErrorCode.AGENCY_NOT_FOUND,
      );
      const uniqueIds = [...new Set(ids)];
      const repository = manager.getRepository(AgencyContactEntity);
      const entities = await repository.findBy({ agencyId, id: In(uniqueIds) });
      assertAllFound(
        uniqueIds,
        entities.map((item) => item.id),
        ErrorCode.AGENCY_CONTACT_NOT_FOUND,
      );
      await repository
        .createQueryBuilder()
        .update()
        .set({ updatedBy: actorId })
        .where('agency_id = :agencyId', { agencyId })
        .andWhere('id IN (:...ids)', { ids: uniqueIds })
        .execute();
      await repository.softDelete({ agencyId, id: In(uniqueIds) });
    });
  }

  private getResponse(
    entity: AgencyEntity,
    contacts: AgencyContactEntity[],
  ): AgencyDetailResponse {
    return {
      ...this.toListResponse(entity),
      contactCount: contacts.length,
      contacts: contacts.map((item) => this.toContactResponse(item)),
    };
  }
  private toListResponse(entity: AgencyEntity): AgencyListItemResponse {
    return {
      ...auditResponse(entity),
      code: entity.code,
      name: entity.name,
      city: entity.city,
      countryOrRegion: entity.countryOrRegion,
      email: entity.email,
      status: entity.status,
      remark: entity.remark,
      contactCount: Number(
        (entity as AgencyEntity & { contactCount?: number }).contactCount ?? 0,
      ),
    };
  }
  private toContactResponse(
    entity: AgencyContactEntity,
  ): AgencyContactResponse {
    return {
      ...auditResponse(entity),
      agencyId: entity.agencyId,
      name: entity.name,
      phone: entity.phone,
    };
  }
}
