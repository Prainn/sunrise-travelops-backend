import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ErrorCode } from '../../common/constants/error-code';
import { PageResult } from '../../common/types/page-result';
import {
  actualKeyword,
  actualPage,
  auditResponse,
  normalizeMoney,
} from '../common/resource.dto';
import {
  assertAllFound,
  assertMatchingId,
  assertVersion,
} from '../common/resource-errors';
import {
  ensureCodeAvailable,
  normalizeNullable,
  requireResource,
  requireResourceForUpdate,
  requireResources,
} from '../common/resource-service.helpers';
import { ResourceValidationService } from '../common/resource-validation.service';
import { AttractionEntity, AttractionPriceEntity } from './attraction.entity';
import {
  AttractionDetailResponse,
  AttractionListItemResponse,
  AttractionPriceResponse,
  AttractionQueryDto,
  CreateAttractionDto,
  CreateAttractionPriceDto,
  UpdateAttractionDto,
  UpdateAttractionPriceDto,
} from './dto/attraction.dto';

@Injectable()
export class AttractionsService {
  constructor(
    @InjectRepository(AttractionEntity)
    private readonly attractions: Repository<AttractionEntity>,
    @InjectRepository(AttractionPriceEntity)
    private readonly prices: Repository<AttractionPriceEntity>,
    private readonly validation: ResourceValidationService,
    private readonly dataSource: DataSource,
  ) {}
  async list(
    query: AttractionQueryDto,
  ): Promise<PageResult<AttractionListItemResponse>> {
    const page = actualPage(query);
    const builder = this.attractions
      .createQueryBuilder('attraction')
      .loadRelationCountAndMap('attraction.priceCount', 'attraction.prices')
      .orderBy('attraction.createdAt', 'DESC')
      .addOrderBy('attraction.id', 'ASC')
      .skip((page - 1) * query.pageSize)
      .take(query.pageSize);
    const keyword = actualKeyword(query);
    if (keyword)
      builder.andWhere(
        '(attraction.code ILIKE :keyword OR attraction.name ILIKE :keyword OR attraction.area ILIKE :keyword OR attraction.remark ILIKE :keyword)',
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
      list: entities.map((item) => this.toListResponse(item)),
      total,
      page,
      pageSize: query.pageSize,
    };
  }
  async get(id: string): Promise<AttractionDetailResponse> {
    const entity = await this.attractions.findOne({
      where: { id },
      relations: { prices: true },
    });
    if (!entity)
      throw new BusinessException({
        code: ErrorCode.ATTRACTION_NOT_FOUND,
        message: 'Attraction was not found',
        status: HttpStatus.NOT_FOUND,
      });
    return this.toDetailResponse(entity, entity.prices);
  }
  async create(
    input: CreateAttractionDto,
    actorId: string,
  ): Promise<AttractionDetailResponse> {
    await this.validation.validateCity(input.area);
    await this.validation.validateUnit(input.unit, 'attraction');
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(AttractionEntity);
      await ensureCodeAvailable(repository, input.code);
      const entity = await repository.save(
        repository.create({
          ...input,
          prices: [],
          createdBy: actorId,
          updatedBy: actorId,
        }),
      );
      return this.toDetailResponse(entity, []);
    });
  }
  async update(
    id: string,
    input: UpdateAttractionDto,
    actorId: string,
  ): Promise<AttractionDetailResponse> {
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
      await ensureCodeAvailable(repository, input.code, id);
      Object.assign(entity, input, { id, updatedBy: actorId });
      const saved = await repository.save(entity);
      const prices = await manager
        .getRepository(AttractionPriceEntity)
        .findBy({ attractionId: id });
      return this.toDetailResponse(saved, prices);
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
      const prices = manager.getRepository(AttractionPriceEntity);
      await prices
        .createQueryBuilder()
        .update()
        .set({ updatedBy: actorId })
        .where('attraction_id IN (:...ids)', { ids: uniqueIds })
        .andWhere('deleted_at IS NULL')
        .execute();
      await prices.softDelete({ attractionId: In(uniqueIds) });
      await repository
        .createQueryBuilder()
        .update()
        .set({ updatedBy: actorId })
        .whereInIds(uniqueIds)
        .execute();
      await repository.softDelete(uniqueIds);
    });
  }
  async listPrices(attractionId: string): Promise<AttractionPriceResponse[]> {
    await requireResource(
      this.attractions,
      attractionId,
      ErrorCode.ATTRACTION_NOT_FOUND,
    );
    return (
      await this.prices.find({
        where: { attractionId },
        order: { createdAt: 'ASC', id: 'ASC' },
      })
    ).map((item) => this.toPriceResponse(item));
  }
  async createPrice(
    attractionId: string,
    input: CreateAttractionPriceDto,
    actorId: string,
  ): Promise<AttractionPriceResponse> {
    this.validateDates(input.startDate, input.endDate);
    return this.dataSource.transaction(async (manager) => {
      await requireResource(
        manager.getRepository(AttractionEntity),
        attractionId,
        ErrorCode.ATTRACTION_NOT_FOUND,
      );
      await this.validation.validateUnit(input.unit, 'attraction');
      const repository = manager.getRepository(AttractionPriceEntity);
      const amounts = this.amounts(input);
      return this.toPriceResponse(
        await repository.save(
          repository.create({
            ...input,
            ...amounts,
            attractionId,
            startDate: normalizeNullable(input.startDate),
            endDate: normalizeNullable(input.endDate),
            createdBy: actorId,
            updatedBy: actorId,
          }),
        ),
      );
    });
  }
  async updatePrice(
    attractionId: string,
    priceId: string,
    input: UpdateAttractionPriceDto,
    actorId: string,
  ): Promise<AttractionPriceResponse> {
    assertMatchingId(input.id, priceId);
    this.validateDates(input.startDate, input.endDate);
    return this.dataSource.transaction(async (manager) => {
      await requireResource(
        manager.getRepository(AttractionEntity),
        attractionId,
        ErrorCode.ATTRACTION_NOT_FOUND,
      );
      await this.validation.validateUnit(input.unit, 'attraction');
      const repository = manager.getRepository(AttractionPriceEntity);
      const entity = await repository.findOne({
        where: { id: priceId, attractionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!entity)
        throw new BusinessException({
          code: ErrorCode.ATTRACTION_PRICE_NOT_FOUND,
          message: 'Price was not found for this attraction',
          status: HttpStatus.NOT_FOUND,
        });
      assertVersion(entity.version, input.version);
      Object.assign(entity, input, this.amounts(input), {
        id: priceId,
        attractionId,
        startDate: normalizeNullable(input.startDate),
        endDate: normalizeNullable(input.endDate),
        updatedBy: actorId,
      });
      return this.toPriceResponse(await repository.save(entity));
    });
  }
  async deletePrices(
    attractionId: string,
    ids: string[],
    actorId: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await requireResource(
        manager.getRepository(AttractionEntity),
        attractionId,
        ErrorCode.ATTRACTION_NOT_FOUND,
      );
      const uniqueIds = [...new Set(ids)];
      const repository = manager.getRepository(AttractionPriceEntity);
      const entities = await repository.findBy({
        attractionId,
        id: In(uniqueIds),
      });
      assertAllFound(
        uniqueIds,
        entities.map((item) => item.id),
        ErrorCode.ATTRACTION_PRICE_NOT_FOUND,
      );
      await repository
        .createQueryBuilder()
        .update()
        .set({ updatedBy: actorId })
        .where('attraction_id = :attractionId', { attractionId })
        .andWhere('id IN (:...ids)', { ids: uniqueIds })
        .execute();
      await repository.softDelete({ attractionId, id: In(uniqueIds) });
    });
  }
  private validateDates(start?: string | null, end?: string | null): void {
    if (start && end && start > end)
      throw new BusinessException({
        code: ErrorCode.ATTRACTION_PRICE_DATE_INVALID,
        message: 'Start date must not be after end date',
        status: HttpStatus.BAD_REQUEST,
      });
  }
  private amounts(input: CreateAttractionPriceDto): {
    rackPrice: string;
    settlementPrice: string;
  } {
    return input.isFree
      ? { rackPrice: '0.00', settlementPrice: '0.00' }
      : {
          rackPrice: normalizeMoney(input.rackPrice),
          settlementPrice: normalizeMoney(input.settlementPrice),
        };
  }
  private toListResponse(entity: AttractionEntity): AttractionListItemResponse {
    return {
      ...auditResponse(entity),
      code: entity.code,
      name: entity.name,
      area: entity.area,
      category: entity.category,
      restroomLocation: entity.restroomLocation,
      remark: entity.remark,
      unit: entity.unit,
      status: entity.status,
      priceCount: Number(
        (entity as AttractionEntity & { priceCount?: number }).priceCount ?? 0,
      ),
    };
  }
  private toDetailResponse(
    entity: AttractionEntity,
    prices: AttractionPriceEntity[],
  ): AttractionDetailResponse {
    return {
      ...this.toListResponse(entity),
      priceCount: prices.length,
      prices: prices.map((item) => this.toPriceResponse(item)),
    };
  }
  private toPriceResponse(
    entity: AttractionPriceEntity,
  ): AttractionPriceResponse {
    return {
      ...auditResponse(entity),
      attractionId: entity.attractionId,
      itemType: entity.itemType,
      itemName: entity.itemName,
      audience: entity.audience,
      periodName: entity.periodName,
      startDate: entity.startDate,
      endDate: entity.endDate,
      rackPrice: normalizeMoney(entity.rackPrice),
      settlementPrice: normalizeMoney(entity.settlementPrice),
      unit: entity.unit,
      isFree: entity.isFree,
      priceNote: entity.priceNote,
    };
  }
}
