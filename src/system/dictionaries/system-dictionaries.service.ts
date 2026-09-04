import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { ErrorCode, ErrorCodeValue } from '../../common/constants/error-code';
import { BusinessException } from '../../common/exceptions/business.exception';
import { PageResult } from '../../common/types/page-result';
import { DictionaryItemEntity } from './dictionary-item.entity';
import { DictionaryTypeEntity } from './dictionary-type.entity';
import {
  DictionaryItemInputDto,
  DictionaryItemOptionResponse,
  DictionaryItemQueryDto,
  DictionaryItemResponse,
  DictionaryTypeInputDto,
  DictionaryTypeOptionResponse,
  DictionaryTypeQueryDto,
  DictionaryTypeResponse,
} from './dto/dictionary.dto';
import { DictionaryStatus } from './dictionary-status';

@Injectable()
export class SystemDictionariesService {
  constructor(
    @InjectRepository(DictionaryTypeEntity)
    private readonly dictionaryTypes: Repository<DictionaryTypeEntity>,
    @InjectRepository(DictionaryItemEntity)
    private readonly dictionaryItems: Repository<DictionaryItemEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async getDictionaryTypePage(
    query: DictionaryTypeQueryDto,
  ): Promise<PageResult<DictionaryTypeResponse>> {
    const builder = this.dictionaryTypes
      .createQueryBuilder('dictionaryType')
      .orderBy('dictionaryType.createdAt', 'ASC')
      .addOrderBy('dictionaryType.id', 'ASC');

    const keyword = query.keyword?.trim() || undefined;
    if (keyword) {
      builder.andWhere(
        '(dictionaryType.name ILIKE :keyword OR dictionaryType.dictCode ILIKE :keyword)',
        { keyword: `%${keyword}%` },
      );
    }
    if (query.status !== undefined) {
      builder.andWhere('dictionaryType.status = :status', {
        status: query.status,
      });
    }

    const page = query.page;
    const [entities, total] = await builder
      .skip((page - 1) * query.pageSize)
      .take(query.pageSize)
      .getManyAndCount();

    return {
      list: entities.map((entity) => this.toDictionaryTypeResponse(entity)),
      total,
      page,
      pageSize: query.pageSize,
    };
  }

  async getDictionaryTypeOptions(): Promise<DictionaryTypeOptionResponse[]> {
    const entities = await this.dictionaryTypes.find({
      where: { status: DictionaryStatus.Enabled },
      order: { name: 'ASC', dictCode: 'ASC' },
    });
    return entities.map((entity) => ({
      value: entity.dictCode,
      label: entity.name,
    }));
  }

  async getDictionaryType(id: string): Promise<DictionaryTypeResponse> {
    return this.toDictionaryTypeResponse(
      await this.requireDictionaryTypeById(id),
    );
  }

  async createDictionaryType(
    input: DictionaryTypeInputDto,
    actorId: string,
  ): Promise<DictionaryTypeResponse> {
    await this.ensureDictionaryCodeAvailable(input.dictCode);
    const entity = this.dictionaryTypes.create({
      name: input.name,
      dictCode: input.dictCode,
      status: input.status,
      remark: input.remark || null,
      createdBy: actorId,
      updatedBy: actorId,
    });
    return this.toDictionaryTypeResponse(
      await this.dictionaryTypes.save(entity),
    );
  }

  async updateDictionaryType(
    id: string,
    input: DictionaryTypeInputDto,
    actorId: string,
  ): Promise<DictionaryTypeResponse> {
    this.assertMatchingId(input.id, id);
    const entity = await this.requireDictionaryTypeById(id);
    await this.ensureDictionaryCodeAvailable(input.dictCode, id);

    entity.name = input.name;
    entity.dictCode = input.dictCode;
    entity.status = input.status;
    entity.remark = input.remark || null;
    entity.updatedBy = actorId;

    return this.toDictionaryTypeResponse(
      await this.dictionaryTypes.save(entity),
    );
  }

  async deleteDictionaryTypes(ids: string[], actorId: string): Promise<void> {
    const uniqueIds = [...new Set(ids)];
    const existing = await this.dictionaryTypes.findBy({ id: In(uniqueIds) });
    this.assertAllFound(
      uniqueIds,
      existing.map((entity) => entity.id),
      ErrorCode.DICTIONARY_TYPES_NOT_FOUND,
      'One or more dictionary types were not found',
    );

    await this.dataSource.transaction(async (manager) => {
      await manager
        .getRepository(DictionaryItemEntity)
        .createQueryBuilder()
        .update(DictionaryItemEntity)
        .set({ updatedBy: actorId })
        .where('type_id IN (:...typeIds)', { typeIds: uniqueIds })
        .andWhere('deleted_at IS NULL')
        .execute();
      await manager
        .getRepository(DictionaryItemEntity)
        .softDelete({ typeId: In(uniqueIds) });

      await manager
        .getRepository(DictionaryTypeEntity)
        .createQueryBuilder()
        .update(DictionaryTypeEntity)
        .set({ updatedBy: actorId })
        .where('id IN (:...ids)', { ids: uniqueIds })
        .andWhere('deleted_at IS NULL')
        .execute();
      await manager
        .getRepository(DictionaryTypeEntity)
        .softDelete({ id: In(uniqueIds) });
    });
  }

  async getDictionaryItemPage(
    dictCode: string,
    query: DictionaryItemQueryDto,
  ): Promise<PageResult<DictionaryItemResponse>> {
    const dictionaryType = await this.requireDictionaryTypeByCode(dictCode);
    const builder = this.dictionaryItems
      .createQueryBuilder('dictionaryItem')
      .where('dictionaryItem.typeId = :typeId', {
        typeId: dictionaryType.id,
      })
      .orderBy('dictionaryItem.sort', 'ASC')
      .addOrderBy('dictionaryItem.createdAt', 'ASC')
      .addOrderBy('dictionaryItem.id', 'ASC');

    const keyword = query.keyword?.trim() || undefined;
    if (keyword) {
      builder.andWhere(
        '(dictionaryItem.label ILIKE :keyword OR dictionaryItem.value ILIKE :keyword)',
        { keyword: `%${keyword}%` },
      );
    }
    if (query.status !== undefined) {
      builder.andWhere('dictionaryItem.status = :status', {
        status: query.status,
      });
    }

    const page = query.page;
    const [entities, total] = await builder
      .skip((page - 1) * query.pageSize)
      .take(query.pageSize)
      .getManyAndCount();

    return {
      list: entities.map((entity) =>
        this.toDictionaryItemResponse(entity, dictionaryType.dictCode),
      ),
      total,
      page,
      pageSize: query.pageSize,
    };
  }

  async getDictionaryItemOptions(
    dictCode: string,
  ): Promise<DictionaryItemOptionResponse[]> {
    const dictionaryType = await this.requireDictionaryTypeByCode(dictCode);
    const entities = await this.dictionaryItems.find({
      where: {
        typeId: dictionaryType.id,
        status: DictionaryStatus.Enabled,
      },
      order: { sort: 'ASC', createdAt: 'ASC', id: 'ASC' },
    });
    return entities.map((entity) => ({
      value: entity.value,
      label: entity.label,
      tagType: entity.tagType,
    }));
  }

  async getDictionaryItem(
    dictCode: string,
    id: string,
  ): Promise<DictionaryItemResponse> {
    const dictionaryType = await this.requireDictionaryTypeByCode(dictCode);
    const entity = await this.requireDictionaryItem(id, dictionaryType.id);
    return this.toDictionaryItemResponse(entity, dictionaryType.dictCode);
  }

  async createDictionaryItem(
    dictCode: string,
    input: DictionaryItemInputDto,
    actorId: string,
  ): Promise<DictionaryItemResponse> {
    this.assertMatchingDictCode(input.dictCode, dictCode);
    const dictionaryType = await this.requireDictionaryTypeByCode(dictCode);
    await this.ensureDictionaryItemValueAvailable(
      dictionaryType.id,
      input.value,
    );

    const entity = this.dictionaryItems.create({
      typeId: dictionaryType.id,
      label: input.label,
      value: input.value,
      status: input.status,
      sort: input.sort,
      tagType: input.tagType,
      createdBy: actorId,
      updatedBy: actorId,
    });
    return this.toDictionaryItemResponse(
      await this.dictionaryItems.save(entity),
      dictionaryType.dictCode,
    );
  }

  async updateDictionaryItem(
    dictCode: string,
    id: string,
    input: DictionaryItemInputDto,
    actorId: string,
  ): Promise<DictionaryItemResponse> {
    this.assertMatchingId(input.id, id);
    this.assertMatchingDictCode(input.dictCode, dictCode);
    const dictionaryType = await this.requireDictionaryTypeByCode(dictCode);
    const entity = await this.requireDictionaryItem(id, dictionaryType.id);
    await this.ensureDictionaryItemValueAvailable(
      dictionaryType.id,
      input.value,
      id,
    );

    entity.label = input.label;
    entity.value = input.value;
    entity.status = input.status;
    entity.sort = input.sort;
    entity.tagType = input.tagType;
    entity.updatedBy = actorId;

    return this.toDictionaryItemResponse(
      await this.dictionaryItems.save(entity),
      dictionaryType.dictCode,
    );
  }

  async deleteDictionaryItems(
    dictCode: string,
    ids: string[],
    actorId: string,
  ): Promise<void> {
    const dictionaryType = await this.requireDictionaryTypeByCode(dictCode);
    const uniqueIds = [...new Set(ids)];
    const existing = await this.dictionaryItems.findBy({
      id: In(uniqueIds),
      typeId: dictionaryType.id,
    });
    this.assertAllFound(
      uniqueIds,
      existing.map((entity) => entity.id),
      ErrorCode.DICTIONARY_ITEMS_NOT_FOUND,
      'One or more dictionary items were not found in this dictionary type',
    );

    await this.dataSource.transaction(async (manager) => {
      await manager
        .getRepository(DictionaryItemEntity)
        .createQueryBuilder()
        .update(DictionaryItemEntity)
        .set({ updatedBy: actorId })
        .where('id IN (:...ids)', { ids: uniqueIds })
        .andWhere('type_id = :typeId', { typeId: dictionaryType.id })
        .andWhere('deleted_at IS NULL')
        .execute();
      await manager.getRepository(DictionaryItemEntity).softDelete({
        id: In(uniqueIds),
        typeId: dictionaryType.id,
      });
    });
  }

  private async requireDictionaryTypeById(
    id: string,
  ): Promise<DictionaryTypeEntity> {
    const entity = await this.dictionaryTypes.findOneBy({ id });
    if (!entity) {
      throw new BusinessException({
        code: ErrorCode.DICTIONARY_TYPE_NOT_FOUND,
        message: 'Dictionary type not found',
        status: HttpStatus.NOT_FOUND,
        details: { id },
      });
    }
    return entity;
  }

  private async requireDictionaryTypeByCode(
    dictCode: string,
  ): Promise<DictionaryTypeEntity> {
    const entity = await this.dictionaryTypes.findOneBy({ dictCode });
    if (!entity) {
      throw new BusinessException({
        code: ErrorCode.DICTIONARY_TYPE_NOT_FOUND,
        message: 'Dictionary type not found',
        status: HttpStatus.NOT_FOUND,
        details: { dictCode },
      });
    }
    return entity;
  }

  private async requireDictionaryItem(
    id: string,
    typeId: string,
  ): Promise<DictionaryItemEntity> {
    const entity = await this.dictionaryItems.findOneBy({ id, typeId });
    if (!entity) {
      throw new BusinessException({
        code: ErrorCode.DICTIONARY_ITEM_NOT_FOUND,
        message: 'Dictionary item not found',
        status: HttpStatus.NOT_FOUND,
        details: { id },
      });
    }
    return entity;
  }

  private async ensureDictionaryCodeAvailable(
    dictCode: string,
    currentId?: string,
  ): Promise<void> {
    const builder = this.dictionaryTypes
      .createQueryBuilder('dictionaryType')
      .withDeleted()
      .where('dictionaryType.dictCode = :dictCode', { dictCode });
    if (currentId) {
      builder.andWhere('dictionaryType.id != :currentId', { currentId });
    }
    if (await builder.getExists()) {
      throw new BusinessException({
        code: ErrorCode.DICTIONARY_CODE_EXISTS,
        message: 'Dictionary code already exists',
        status: HttpStatus.CONFLICT,
        details: { dictCode },
      });
    }
  }

  private async ensureDictionaryItemValueAvailable(
    typeId: string,
    value: string,
    currentId?: string,
  ): Promise<void> {
    const builder = this.dictionaryItems
      .createQueryBuilder('dictionaryItem')
      .withDeleted()
      .where('dictionaryItem.typeId = :typeId', { typeId })
      .andWhere('dictionaryItem.value = :value', { value });
    if (currentId) {
      builder.andWhere('dictionaryItem.id != :currentId', { currentId });
    }
    if (await builder.getExists()) {
      throw new BusinessException({
        code: ErrorCode.DICTIONARY_ITEM_VALUE_EXISTS,
        message: 'Dictionary item value already exists in this dictionary type',
        status: HttpStatus.CONFLICT,
        details: { value },
      });
    }
  }

  private assertMatchingId(inputId: string | undefined, pathId: string): void {
    if (inputId && inputId !== pathId) {
      throw new BusinessException({
        code: ErrorCode.DICTIONARY_ID_MISMATCH,
        message: 'The body ID does not match the path ID',
        status: HttpStatus.BAD_REQUEST,
      });
    }
  }

  private assertMatchingDictCode(
    inputCode: string | undefined,
    pathCode: string,
  ): void {
    if (inputCode && inputCode !== pathCode) {
      throw new BusinessException({
        code: ErrorCode.DICTIONARY_CODE_MISMATCH,
        message:
          'The body dictionary code does not match the path dictionary code',
        status: HttpStatus.BAD_REQUEST,
      });
    }
  }

  private assertAllFound(
    requestedIds: string[],
    foundIds: string[],
    code: ErrorCodeValue,
    message: string,
  ): void {
    const found = new Set(foundIds);
    const missingIds = requestedIds.filter((id) => !found.has(id));
    if (missingIds.length > 0) {
      throw new BusinessException({
        code,
        message,
        status: HttpStatus.NOT_FOUND,
        details: {
          missingIds,
        },
      });
    }
  }

  private toDictionaryTypeResponse(
    entity: DictionaryTypeEntity,
  ): DictionaryTypeResponse {
    return {
      id: entity.id,
      name: entity.name,
      dictCode: entity.dictCode,
      status: entity.status,
      ...(entity.remark ? { remark: entity.remark } : {}),
    };
  }

  private toDictionaryItemResponse(
    entity: DictionaryItemEntity,
    dictCode: string,
  ): DictionaryItemResponse {
    return {
      id: entity.id,
      dictCode,
      label: entity.label,
      value: entity.value,
      status: entity.status,
      sort: entity.sort,
      tagType: entity.tagType,
    };
  }
}
