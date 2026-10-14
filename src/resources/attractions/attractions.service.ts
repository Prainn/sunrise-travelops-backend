import { nextBusinessCode } from '../../common/business-code';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ErrorCode } from '../../common/constants/error-code';
import { PageResult } from '../../common/types/page-result';
import {
  actualKeyword,
  actualPage,
  auditResponse,
  normalizeMoney,
} from '../common/resource.dto';
import { assertMatchingId, assertVersion } from '../common/resource-errors';
import {
  ensureCodeAvailable,
  requireResource,
  requireResourceForUpdate,
  requireResources,
} from '../common/resource-service.helpers';
import { ResourceValidationService } from '../common/resource-validation.service';
import { AttractionEntity } from './attraction.entity';
import {
  AttractionQueryDto,
  AttractionResponse,
  CreateAttractionDto,
  UpdateAttractionDto,
} from './dto/attraction.dto';

@Injectable()
export class AttractionsService {
  constructor(
    @InjectRepository(AttractionEntity)
    private readonly attractions: Repository<AttractionEntity>,
    private readonly validation: ResourceValidationService,
    private readonly dataSource: DataSource,
  ) {}
  async list(
    query: AttractionQueryDto,
  ): Promise<PageResult<AttractionResponse>> {
    const page = actualPage(query);
    const builder = this.attractions
      .createQueryBuilder('attraction')
      .orderBy(
        "CAST(SUBSTRING(attraction.code FROM '[0-9]+$') AS bigint)",
        'ASC',
      )
      .addOrderBy('attraction.code', 'ASC')
      .addOrderBy('attraction.id', 'ASC')
      .skip((page - 1) * query.pageSize)
      .take(query.pageSize);
    const keyword = actualKeyword(query);
    if (keyword)
      builder.andWhere(
        '(attraction.code ILIKE :keyword OR attraction.name ILIKE :keyword OR attraction.area ILIKE :keyword OR attraction.description ILIKE :keyword OR attraction.remark ILIKE :keyword)',
        { keyword: `%${keyword}%` },
      );
    if (query.status)
      builder.andWhere('attraction.status = :status', { status: query.status });
    if (query.area)
      builder.andWhere('attraction.area = :area', { area: query.area });
    if (query.category)
      builder.andWhere('attraction.category = :category', {
        category: query.category,
      });
    if (query.unit)
      builder.andWhere('attraction.unit = :unit', { unit: query.unit });
    const [entities, total] = await builder.getManyAndCount();
    return {
      list: entities.map((item) => this.toResponse(item)),
      total,
      page,
      pageSize: query.pageSize,
    };
  }
  async get(id: string): Promise<AttractionResponse> {
    return this.toResponse(
      await requireResource(
        this.attractions,
        id,
        ErrorCode.ATTRACTION_NOT_FOUND,
      ),
    );
  }
  async create(
    input: CreateAttractionDto,
    actorId: string,
  ): Promise<AttractionResponse> {
    await this.validation.validateCity(input.area, undefined);
    await this.validation.validateUnit(input.unit, 'attraction');
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(AttractionEntity);
      const code =
        input.code ?? (await nextBusinessCode(repository.manager, 'ATT'));
      await ensureCodeAvailable(repository, code);
      const entity = await repository.save(
        repository.create({
          ...this.fields(input),
          code,
          createdBy: actorId,
          updatedBy: actorId,
        }),
      );
      return this.toResponse(entity);
    });
  }
  async update(
    id: string,
    input: UpdateAttractionDto,
    actorId: string,
  ): Promise<AttractionResponse> {
    assertMatchingId(input.id, id);
    await this.validation.validateUnit(input.unit, 'attraction');
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(AttractionEntity);
      const entity = await requireResourceForUpdate(
        repository,
        id,
        ErrorCode.ATTRACTION_NOT_FOUND,
      );
      assertVersion(entity.version, input.version);
      await this.validation.validateCity(input.area, entity.area);
      input.code ??= entity.code;
      await ensureCodeAvailable(repository, input.code, id);
      Object.assign(entity, this.fields(input), {
        id,
        code: input.code,
        updatedBy: actorId,
      });
      return this.toResponse(await repository.save(entity));
    });
  }
  async delete(ids: string[], actorId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(AttractionEntity);
      const entities = await requireResources(
        repository,
        ids,
        ErrorCode.ATTRACTION_NOT_FOUND,
      );
      const uniqueIds = entities.map((item) => item.id);
      await repository
        .createQueryBuilder()
        .update()
        .set({ updatedBy: actorId })
        .whereInIds(uniqueIds)
        .execute();
      await repository.softDelete(uniqueIds);
    });
  }
  private fields(input: CreateAttractionDto) {
    return {
      name: input.name,
      status: input.status,
      area: input.area,
      description: input.description,
      price: normalizeMoney(input.price),
      unit: input.unit,
      category: input.category ?? null,
      restroomLocation: input.restroomLocation ?? '',
      isStandardPrice: input.isStandardPrice ?? false,
      remark: input.remark ?? '',
    };
  }
  private toResponse(entity: AttractionEntity): AttractionResponse {
    return {
      ...auditResponse(entity),
      code: entity.code,
      name: entity.name,
      area: entity.area,
      category: entity.category,
      restroomLocation: entity.restroomLocation,
      description: entity.description,
      isStandardPrice: entity.isStandardPrice,
      remark: entity.remark,
      unit: entity.unit,
      price: entity.price == null ? null : normalizeMoney(entity.price),
      status: entity.status,
    };
  }
}
