import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Not, Repository } from 'typeorm';
import { ApplicationError } from '../../common/errors/application-error';
import { BusinessDictionaryItemEntity } from './business-dictionary-item.entity';
import { BusinessDictionaryTypeEntity } from './business-dictionary-type.entity';
import {
  BusinessDictionaryItemInputDto,
  BusinessDictionaryItemQueryDto,
  BusinessDictionaryItemResponse,
  BusinessDictionaryTypeInputDto,
  BusinessDictionaryTypeResponse,
} from './dto/business-dictionary.dto';

@Injectable()
export class SystemBusinessDictionariesService {
  constructor(
    @InjectRepository(BusinessDictionaryTypeEntity)
    private readonly dictionaryTypes: Repository<BusinessDictionaryTypeEntity>,
    @InjectRepository(BusinessDictionaryItemEntity)
    private readonly dictionaryItems: Repository<BusinessDictionaryItemEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async getDictionaryTypes(): Promise<BusinessDictionaryTypeResponse[]> {
    const entities = await this.dictionaryTypes.find({
      relations: { items: true },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    return entities.map((entity) => this.toTypeResponse(entity));
  }

  async createDictionaryType(
    input: BusinessDictionaryTypeInputDto,
    actorId: string,
  ): Promise<BusinessDictionaryTypeResponse> {
    await this.ensureTypeCodeAvailable(input.code);
    const entity = this.dictionaryTypes.create({
      code: input.code,
      name: input.name,
      englishName: input.englishName,
      builtIn: false,
      items: [],
      createdBy: actorId,
      updatedBy: actorId,
    });
    return this.toTypeResponse(await this.dictionaryTypes.save(entity));
  }

  async updateDictionaryType(
    id: string,
    input: BusinessDictionaryTypeInputDto,
    actorId: string,
  ): Promise<BusinessDictionaryTypeResponse> {
    this.assertMatchingId(input.id, id);
    const entity = await this.requireTypeById(id);
    if (entity.builtIn && entity.code !== input.code) {
      throw new ApplicationError(
        'BUILT_IN_BUSINESS_DICTIONARY_CODE_IMMUTABLE',
        'The code of a built-in business dictionary cannot be changed',
        HttpStatus.CONFLICT,
      );
    }
    await this.ensureTypeCodeAvailable(input.code, id);
    entity.code = input.code;
    entity.name = input.name;
    entity.englishName = input.englishName;
    entity.updatedBy = actorId;
    entity.items = await this.dictionaryItems.findBy({ typeId: id });
    return this.toTypeResponse(await this.dictionaryTypes.save(entity));
  }

  async deleteDictionaryTypes(ids: string[], actorId: string): Promise<void> {
    const uniqueIds = [...new Set(ids)];
    const entities = await this.dictionaryTypes.findBy({ id: In(uniqueIds) });
    this.assertAllFound(
      uniqueIds,
      entities.map((entity) => entity.id),
      'BUSINESS_DICTIONARY_TYPES_NOT_FOUND',
      'One or more business dictionary types were not found',
    );
    if (entities.some((entity) => entity.builtIn)) {
      throw new ApplicationError(
        'BUILT_IN_BUSINESS_DICTIONARY_CANNOT_BE_DELETED',
        'Built-in business dictionary types cannot be deleted',
        HttpStatus.CONFLICT,
      );
    }

    await this.dataSource.transaction(async (manager) => {
      await manager
        .getRepository(BusinessDictionaryItemEntity)
        .createQueryBuilder()
        .update()
        .set({ updatedBy: actorId })
        .where('type_id IN (:...ids)', { ids: uniqueIds })
        .andWhere('deleted_at IS NULL')
        .execute();
      await manager
        .getRepository(BusinessDictionaryItemEntity)
        .softDelete({ typeId: In(uniqueIds) });
      await manager
        .getRepository(BusinessDictionaryTypeEntity)
        .createQueryBuilder()
        .update()
        .set({ updatedBy: actorId })
        .where('id IN (:...ids)', { ids: uniqueIds })
        .andWhere('deleted_at IS NULL')
        .execute();
      await manager
        .getRepository(BusinessDictionaryTypeEntity)
        .softDelete({ id: In(uniqueIds) });
    });
  }

  async getDictionaryItems(
    typeCode: string,
    query: BusinessDictionaryItemQueryDto,
  ): Promise<BusinessDictionaryItemResponse[]> {
    const type = await this.requireTypeByCode(typeCode);
    const builder = this.dictionaryItems
      .createQueryBuilder('item')
      .where('item.typeId = :typeId', { typeId: type.id })
      .orderBy('item.createdAt', 'ASC')
      .addOrderBy('item.id', 'ASC');
    if (query.keyword) {
      builder.andWhere(
        '(item.name ILIKE :keyword OR item.englishName ILIKE :keyword OR item.code ILIKE :keyword)',
        { keyword: `%${query.keyword}%` },
      );
    }
    if (query.status) {
      builder.andWhere('item.status = :status', { status: query.status });
    }
    return (await builder.getMany()).map((entity) =>
      this.toItemResponse(entity),
    );
  }

  async createDictionaryItem(
    typeCode: string,
    input: BusinessDictionaryItemInputDto,
    actorId: string,
  ): Promise<BusinessDictionaryItemResponse> {
    const type = await this.requireTypeByCode(typeCode);
    this.validateResourceTypes(typeCode, input.resourceTypes);
    await this.ensureItemCodeAvailable(type.id, input.code);
    const entity = this.dictionaryItems.create({
      typeId: type.id,
      code: input.code,
      name: input.name,
      englishName: input.englishName,
      resourceTypes: typeCode === 'resource-unit' ? input.resourceTypes : [],
      status: input.status,
      remark: input.remark,
      createdBy: actorId,
      updatedBy: actorId,
    });
    return this.toItemResponse(await this.dictionaryItems.save(entity));
  }

  async updateDictionaryItem(
    typeCode: string,
    id: string,
    input: BusinessDictionaryItemInputDto,
    actorId: string,
  ): Promise<BusinessDictionaryItemResponse> {
    this.assertMatchingId(input.id, id);
    const type = await this.requireTypeByCode(typeCode);
    const entity = await this.requireItem(id, type.id);
    this.validateResourceTypes(typeCode, input.resourceTypes);
    await this.ensureItemCodeAvailable(type.id, input.code, id);
    entity.code = input.code;
    entity.name = input.name;
    entity.englishName = input.englishName;
    entity.resourceTypes =
      typeCode === 'resource-unit' ? input.resourceTypes : [];
    entity.status = input.status;
    entity.remark = input.remark;
    entity.updatedBy = actorId;
    return this.toItemResponse(await this.dictionaryItems.save(entity));
  }

  async deleteDictionaryItems(
    typeCode: string,
    ids: string[],
    actorId: string,
  ): Promise<void> {
    const type = await this.requireTypeByCode(typeCode);
    const uniqueIds = [...new Set(ids)];
    const entities = await this.dictionaryItems.findBy({
      id: In(uniqueIds),
      typeId: type.id,
    });
    this.assertAllFound(
      uniqueIds,
      entities.map((entity) => entity.id),
      'BUSINESS_DICTIONARY_ITEMS_NOT_FOUND',
      'One or more business dictionary items were not found in this type',
    );
    await this.dataSource.transaction(async (manager) => {
      await manager
        .getRepository(BusinessDictionaryItemEntity)
        .createQueryBuilder()
        .update()
        .set({ updatedBy: actorId })
        .where('id IN (:...ids)', { ids: uniqueIds })
        .andWhere('type_id = :typeId', { typeId: type.id })
        .andWhere('deleted_at IS NULL')
        .execute();
      await manager.getRepository(BusinessDictionaryItemEntity).softDelete({
        id: In(uniqueIds),
        typeId: type.id,
      });
    });
  }

  private validateResourceTypes(typeCode: string, resourceTypes: string[]) {
    if (typeCode === 'resource-unit' && resourceTypes.length === 0) {
      throw new ApplicationError(
        'BUSINESS_DICTIONARY_RESOURCE_TYPES_REQUIRED',
        'At least one applicable resource type is required for a resource unit',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private async requireTypeById(
    id: string,
  ): Promise<BusinessDictionaryTypeEntity> {
    const entity = await this.dictionaryTypes.findOneBy({ id });
    if (!entity) {
      throw new ApplicationError(
        'BUSINESS_DICTIONARY_TYPE_NOT_FOUND',
        'Business dictionary type was not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return entity;
  }

  private async requireTypeByCode(
    code: string,
  ): Promise<BusinessDictionaryTypeEntity> {
    const entity = await this.dictionaryTypes.findOneBy({ code });
    if (!entity) {
      throw new ApplicationError(
        'BUSINESS_DICTIONARY_TYPE_NOT_FOUND',
        'Business dictionary type was not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return entity;
  }

  private async requireItem(
    id: string,
    typeId: string,
  ): Promise<BusinessDictionaryItemEntity> {
    const entity = await this.dictionaryItems.findOneBy({ id, typeId });
    if (!entity) {
      throw new ApplicationError(
        'BUSINESS_DICTIONARY_ITEM_NOT_FOUND',
        'Business dictionary item was not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return entity;
  }

  private async ensureTypeCodeAvailable(
    code: string,
    excludedId?: string,
  ): Promise<void> {
    const where = excludedId ? { code, id: Not(excludedId) } : { code };
    if (await this.dictionaryTypes.findOne({ where, withDeleted: true })) {
      throw new ApplicationError(
        'BUSINESS_DICTIONARY_TYPE_CODE_EXISTS',
        'Business dictionary type code already exists',
        HttpStatus.CONFLICT,
      );
    }
  }

  private async ensureItemCodeAvailable(
    typeId: string,
    code: string,
    excludedId?: string,
  ): Promise<void> {
    const where = excludedId
      ? { typeId, code, id: Not(excludedId) }
      : { typeId, code };
    if (await this.dictionaryItems.findOne({ where, withDeleted: true })) {
      throw new ApplicationError(
        'BUSINESS_DICTIONARY_ITEM_CODE_EXISTS',
        'Business dictionary item code already exists in this type',
        HttpStatus.CONFLICT,
      );
    }
  }

  private assertMatchingId(bodyId: string | undefined, pathId: string): void {
    if (bodyId && bodyId !== pathId) {
      throw new ApplicationError(
        'RESOURCE_ID_MISMATCH',
        'Body id does not match path id',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private assertAllFound(
    requestedIds: string[],
    foundIds: string[],
    code: string,
    message: string,
  ): void {
    const found = new Set(foundIds);
    const missingIds = requestedIds.filter((id) => !found.has(id));
    if (missingIds.length) {
      throw new ApplicationError(code, message, HttpStatus.NOT_FOUND, {
        missingIds,
      });
    }
  }

  private toTypeResponse(
    entity: BusinessDictionaryTypeEntity,
  ): BusinessDictionaryTypeResponse {
    return {
      id: entity.id,
      code: entity.code,
      name: entity.name,
      englishName: entity.englishName,
      builtIn: entity.builtIn,
      items: (entity.items ?? [])
        .sort(
          (left, right) =>
            left.createdAt.getTime() - right.createdAt.getTime() ||
            left.id.localeCompare(right.id),
        )
        .map((item) => this.toItemResponse(item)),
    };
  }

  private toItemResponse(
    entity: BusinessDictionaryItemEntity,
  ): BusinessDictionaryItemResponse {
    return {
      id: entity.id,
      code: entity.code,
      name: entity.name,
      englishName: entity.englishName,
      resourceTypes: entity.resourceTypes,
      status: entity.status,
      remark: entity.remark,
    };
  }
}
