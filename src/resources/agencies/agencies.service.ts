import { requireDictionaryItem } from '../../common/dictionary-items';
import {
  assertResourceLibrary,
  resourceLibrary,
  scopeResources,
} from '../common/resource-scope';
import { nextBusinessCode } from '../../common/business-code';
import { ResourceValidationService } from '../common/resource-validation.service';
import { ResourceStatus } from '../common/resource.constants';
import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Not, Repository } from 'typeorm';
import { AuthenticatedUser } from '../../auth/auth.types';
import { UserEntity, UserStatus } from '../../users/user.entity';
import { BusinessUnit, libraryFor } from '../../users/user-identity.entity';
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
    private readonly validation: ResourceValidationService,
  ) {}

  async coordinators(businessUnit: BusinessUnit, actor: AuthenticatedUser) {
    if (
      !['shengxu', 'linxi', 'website'].includes(businessUnit) ||
      (actor.scope !== 'headquarters' && actor.scope !== businessUnit)
    )
      throw new BusinessException({
        code: ErrorCode.AUTH_FORBIDDEN,
        message: 'Business unit is not available',
        status: HttpStatus.FORBIDDEN,
      });
    const users = await this.dataSource.manager
      .createQueryBuilder(UserEntity, 'user')
      .innerJoin('user.identities', 'identity')
      .innerJoin('identity.roles', 'role')
      .where('user.status = :status', { status: UserStatus.Enabled })
      .andWhere('user.isSuperuser = false')
      .andWhere('identity.scope = :businessUnit', { businessUnit })
      .andWhere("role.code = 'COORDINATOR' AND role.isEnabled = true")
      .orderBy('user.nickname', 'ASC')
      .getMany();
    return users.map(({ id, nickname, username }) => ({
      id,
      name: nickname,
      username,
    }));
  }

  private async requireCoordinator(
    coordinatorId: string,
    businessUnit: BusinessUnit,
    manager: DataSource['manager'],
  ) {
    const coordinator = await manager
      .createQueryBuilder(UserEntity, 'user')
      .innerJoin('user.identities', 'identity')
      .innerJoin('identity.roles', 'role')
      .where('user.id = :coordinatorId', { coordinatorId })
      .andWhere('user.status = :status', { status: UserStatus.Enabled })
      .andWhere('user.isSuperuser = false')
      .andWhere('identity.scope = :businessUnit', { businessUnit })
      .andWhere("role.code = 'COORDINATOR' AND role.isEnabled = true")
      .getOne();
    if (!coordinator)
      throw new BusinessException({
        code: ErrorCode.INQUIRY_OWNER_INVALID,
        message: 'Coordinator is not available for this business unit',
        status: HttpStatus.BAD_REQUEST,
      });
    return coordinator;
  }

  private async coordinatorNames(ids: (string | null)[]) {
    const uniqueIds = [...new Set(ids.filter((id): id is string => !!id))];
    if (!uniqueIds.length) return new Map<string, string>();
    const users = await this.dataSource.manager.getRepository(UserEntity).find({
      where: { id: In(uniqueIds) },
      select: { id: true, nickname: true },
      withDeleted: true,
    });
    return new Map(users.map((user) => [user.id, user.nickname]));
  }

  private async requireParent(
    parentId: string | null,
    agency: {
      id?: string;
      parentId?: string | null;
      library: 'shengxu' | 'shared';
      businessUnit: BusinessUnit;
    },
    manager: DataSource['manager'],
  ): Promise<AgencyEntity | null> {
    if (!parentId) return null;
    if (parentId === agency.id)
      throw new BusinessException({
        code: ErrorCode.VALIDATION_ERROR,
        message: '父级不能选择当前组团社',
        status: HttpStatus.BAD_REQUEST,
      });
    const repository = manager.getRepository(AgencyEntity);
    const parent = await requireResourceForUpdate(
      repository,
      parentId,
      ErrorCode.AGENCY_NOT_FOUND,
    );
    if (
      parent.parentId ||
      parent.library !== agency.library ||
      parent.businessUnit !== agency.businessUnit ||
      (parent.status !== ResourceStatus.Enabled && parentId !== agency.parentId)
    )
      throw new BusinessException({
        code: ErrorCode.VALIDATION_ERROR,
        message: '父级必须是同业务、同资源库的有效一级组团社',
        status: HttpStatus.BAD_REQUEST,
      });
    if (agency.id && (await repository.existsBy({ parentId: agency.id })))
      throw new BusinessException({
        code: ErrorCode.VALIDATION_ERROR,
        message: '已有二级组团社的一级不能改为二级',
        status: HttpStatus.BAD_REQUEST,
      });
    return parent;
  }

  private agencyName(shortName: string, parent: AgencyEntity | null): string {
    const name = parent ? `${parent.name}-${shortName}` : shortName;
    if (name.length > 150)
      throw new BusinessException({
        code: ErrorCode.VALIDATION_ERROR,
        message: '组团社完整名称不能超过150字',
        status: HttpStatus.BAD_REQUEST,
      });
    return name;
  }

  private agencyBusinessUnit(
    input: CreateAgencyDto,
    actor: AuthenticatedUser,
    library: 'shengxu' | 'shared',
  ): BusinessUnit {
    const businessUnit =
      actor.scope === 'headquarters' ? input.businessUnit : actor.scope;
    if (
      !businessUnit ||
      (input.businessUnit && input.businessUnit !== businessUnit) ||
      libraryFor(businessUnit) !== library
    )
      throw new BusinessException({
        code: ErrorCode.AUTH_FORBIDDEN,
        message: 'Business unit does not match agency library',
        status: HttpStatus.FORBIDDEN,
      });
    return businessUnit;
  }

  async list(
    query: AgencyQueryDto,
  ): Promise<PageResult<AgencyListItemResponse>> {
    const page = actualPage(query);
    const builder = this.agencies
      .createQueryBuilder('agency')
      .leftJoinAndSelect('agency.parent', 'parent')
      .loadRelationCountAndMap('agency.contactCount', 'agency.contacts')
      .loadRelationCountAndMap('agency.childCount', 'agency.children')
      .addSelect(
        "CAST(SUBSTRING(agency.code FROM '[0-9]+$') AS bigint)",
        'agency_sequence',
      )
      .orderBy('agency_sequence', 'ASC')
      .addOrderBy('agency.code', 'ASC')
      .addOrderBy('agency.id', 'ASC')
      .skip((page - 1) * query.pageSize)
      .take(query.pageSize);
    scopeResources(builder, 'agency');
    if (query.parentOnly === 'true')
      builder.andWhere('agency.parentId IS NULL');
    if (query.parentId)
      builder.andWhere('agency.parentId = :parentId', {
        parentId: query.parentId,
      });
    if (query.businessUnit)
      builder.andWhere('agency.businessUnit = :businessUnit', {
        businessUnit: query.businessUnit,
      });
    const keyword = actualKeyword(query);
    if (keyword)
      builder.andWhere(
        '(agency.code ILIKE :keyword OR agency.name ILIKE :keyword OR agency.city ILIKE :keyword OR agency.countryOrRegion ILIKE :keyword OR agency.email ILIKE :keyword)',
        { keyword: `%${keyword}%` },
      );
    if (query.status)
      builder.andWhere('agency.status = :status', { status: query.status });
    const [entities, total] = await builder.getManyAndCount();
    const coordinatorNames = await this.coordinatorNames(
      entities.map((entity) => entity.coordinatorId),
    );
    return {
      list: entities.map((entity) =>
        this.toListResponse(
          entity,
          coordinatorNames.get(entity.coordinatorId ?? '') ?? null,
        ),
      ),
      total,
      page,
      pageSize: query.pageSize,
    };
  }

  async get(id: string): Promise<AgencyDetailResponse> {
    const entity = await this.agencies.findOne({
      where: { id },
      relations: { contacts: true, parent: true },
    });
    if (!entity)
      throw new BusinessException({
        code: ErrorCode.AGENCY_NOT_FOUND,
        message: 'Agency was not found',
        status: HttpStatus.NOT_FOUND,
      });
    assertResourceLibrary(entity);
    const coordinatorNames = await this.coordinatorNames([
      entity.coordinatorId,
    ]);
    return {
      ...this.toListResponse(
        entity,
        coordinatorNames.get(entity.coordinatorId ?? '') ?? null,
      ),
      contactCount: entity.contacts.length,
      childCount: await this.agencies.countBy({ parentId: id }),
      contacts: entity.contacts.map((item) => this.toContactResponse(item)),
    };
  }

  async create(
    input: CreateAgencyDto,
    actor: AuthenticatedUser,
  ): Promise<AgencyDetailResponse> {
    const library = resourceLibrary(true)!;
    const businessUnit = this.agencyBusinessUnit(input, actor, library);
    await this.validation.validateCity(
      input.city,
      undefined,
      resourceLibrary(true)!,
    );
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(AgencyEntity);
      const parent = await this.requireParent(
        input.parentId ?? null,
        { library, businessUnit },
        manager,
      );
      const coordinator = await this.requireCoordinator(
        input.coordinatorId,
        businessUnit,
        manager,
      );
      const code =
        input.code ?? (await nextBusinessCode(repository.manager, 'AGY'));
      await ensureCodeAvailable(repository, code);
      const country = input.countryItemId
        ? await requireDictionaryItem(
            manager,
            'country-region',
            input.countryItemId,
          )
        : { name: '' };
      const entity = repository.create({
        ...input,
        countryOrRegion: country.name,
        parentId: parent?.id ?? null,
        parent,
        name: this.agencyName(input.name, parent),
        businessUnit,
        code,
        library,
        contacts: [],
        createdBy: actor.id,
        updatedBy: actor.id,
      });
      return this.getResponse(
        await repository.save(entity),
        [],
        coordinator.nickname,
      );
    });
  }

  async update(
    id: string,
    input: UpdateAgencyDto,
    actor: AuthenticatedUser,
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
      const businessUnit = this.agencyBusinessUnit(
        input,
        actor,
        entity.library,
      );
      if (entity.businessUnit && entity.businessUnit !== businessUnit)
        throw new BusinessException({
          code: ErrorCode.AUTH_FORBIDDEN,
          message: 'Agency business unit cannot be changed',
          status: HttpStatus.FORBIDDEN,
        });
      const parent = await this.requireParent(
        input.parentId ?? null,
        {
          id,
          parentId: entity.parentId,
          library: entity.library,
          businessUnit,
        },
        manager,
      );
      const coordinator = await this.requireCoordinator(
        input.coordinatorId,
        businessUnit,
        manager,
      );
      await this.validation.validateCity(
        input.city,
        entity.city,
        entity.library,
      );
      input.code ??= entity.code;
      await ensureCodeAvailable(repository, input.code, id);
      const previousName = entity.name;
      const countryItemId =
        input.countryItemId === undefined
          ? entity.countryItemId
          : input.countryItemId;
      const country =
        entity.countryItemId === countryItemId
          ? { name: entity.countryOrRegion }
          : countryItemId
            ? await requireDictionaryItem(
                manager,
                'country-region',
                countryItemId,
              )
            : { name: '' };
      Object.assign(entity, input, {
        id,
        countryOrRegion: country.name,
        countryItemId: countryItemId ?? null,
        businessUnit,
        parentId: parent?.id ?? null,
        parent,
        name: this.agencyName(input.name, parent),
        updatedBy: actor.id,
      });
      const saved = await repository.save(entity);
      if (saved.name !== previousName) {
        const children = await repository
          .createQueryBuilder('child')
          .where('child.parentId = :id', { id })
          .setLock('pessimistic_write')
          .getMany();
        for (const child of children) {
          child.name = this.agencyName(
            child.name.slice(previousName.length + 1),
            saved,
          );
          child.updatedBy = actor.id;
        }
        if (children.length) await repository.save(children);
      }
      const contacts = await manager
        .getRepository(AgencyContactEntity)
        .findBy({ agencyId: id });
      return this.getResponse(
        saved,
        contacts,
        coordinator.nickname,
        await repository.countBy({ parentId: id }),
      );
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
      await repository
        .createQueryBuilder('agency')
        .whereInIds([...uniqueIds].sort())
        .orderBy('agency.id', 'ASC')
        .setLock('pessimistic_write')
        .getMany();
      if (
        await repository.existsBy({
          parentId: In(uniqueIds),
          id: Not(In(uniqueIds)),
        })
      )
        throw new BusinessException({
          code: ErrorCode.RESOURCE_IN_USE,
          message: '请先删除或移出父级下的二级组团社',
          status: HttpStatus.CONFLICT,
        });
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
    coordinatorName: string,
    childCount = 0,
  ): AgencyDetailResponse {
    assertResourceLibrary(entity);
    return {
      ...this.toListResponse(entity, coordinatorName),
      contactCount: contacts.length,
      childCount,
      contacts: contacts.map((item) => this.toContactResponse(item)),
    };
  }
  private toListResponse(
    entity: AgencyEntity,
    coordinatorName: string | null,
  ): AgencyListItemResponse {
    return {
      ...auditResponse(entity),
      library: entity.library,
      businessUnit: entity.businessUnit,
      coordinatorId: entity.coordinatorId,
      coordinatorName,
      parentId: entity.parentId,
      parentName: entity.parent?.name ?? null,
      shortName: entity.parent
        ? entity.name.slice(entity.parent.name.length + 1)
        : entity.name,
      code: entity.code,
      name: entity.name,
      city: entity.city,
      countryItemId: entity.countryItemId,
      countryOrRegion: entity.countryOrRegion,
      email: entity.email,
      status: entity.status,
      remark: entity.remark,
      contactCount: Number(
        (entity as AgencyEntity & { contactCount?: number }).contactCount ?? 0,
      ),
      childCount: Number(
        (entity as AgencyEntity & { childCount?: number }).childCount ?? 0,
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
