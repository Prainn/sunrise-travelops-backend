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
import {
  CreateRestaurantDto,
  CreateRestaurantPriceDto,
  RestaurantDetailResponse,
  RestaurantListItemResponse,
  RestaurantPriceResponse,
  RestaurantQueryDto,
  UpdateRestaurantDto,
  UpdateRestaurantPriceDto,
} from './dto/restaurant.dto';
import { RestaurantEntity, RestaurantPriceEntity } from './restaurant.entity';

@Injectable()
export class RestaurantsService {
  constructor(
    @InjectRepository(RestaurantEntity)
    private readonly restaurants: Repository<RestaurantEntity>,
    @InjectRepository(RestaurantPriceEntity)
    private readonly prices: Repository<RestaurantPriceEntity>,
    private readonly validation: ResourceValidationService,
    private readonly dataSource: DataSource,
  ) {}
  async list(
    query: RestaurantQueryDto,
  ): Promise<PageResult<RestaurantListItemResponse>> {
    const page = actualPage(query);
    const builder = this.restaurants
      .createQueryBuilder('restaurant')
      .loadRelationCountAndMap('restaurant.priceCount', 'restaurant.prices')
      .orderBy('restaurant.createdAt', 'DESC')
      .addOrderBy('restaurant.id', 'ASC')
      .skip((page - 1) * query.pageSize)
      .take(query.pageSize);
    const keyword = actualKeyword(query);
    if (keyword)
      builder.andWhere(
        '(restaurant.code ILIKE :keyword OR restaurant.name ILIKE :keyword OR restaurant.city ILIKE :keyword OR restaurant.cuisine ILIKE :keyword)',
        { keyword: `%${keyword}%` },
      );
    if (query.status)
      builder.andWhere('restaurant.status = :status', { status: query.status });
    if (query.city)
      builder.andWhere('restaurant.city = :city', { city: query.city });
    if (query.unit)
      builder.andWhere('restaurant.unit = :unit', { unit: query.unit });
    const [entities, total] = await builder.getManyAndCount();
    return {
      list: entities.map((item) => this.toListResponse(item)),
      total,
      page,
      pageSize: query.pageSize,
    };
  }
  async get(id: string): Promise<RestaurantDetailResponse> {
    const entity = await this.restaurants.findOne({
      where: { id },
      relations: { prices: true },
    });
    if (!entity)
      throw new BusinessException({
        code: ErrorCode.RESTAURANT_NOT_FOUND,
        message: 'Restaurant was not found',
        status: HttpStatus.NOT_FOUND,
      });
    return this.toDetailResponse(entity, entity.prices);
  }
  async create(
    input: CreateRestaurantDto,
    actorId: string,
  ): Promise<RestaurantDetailResponse> {
    await this.validation.validateCity(input.city);
    await this.validation.validateUnit(input.unit, 'restaurant');
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(RestaurantEntity);
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
    input: UpdateRestaurantDto,
    actorId: string,
  ): Promise<RestaurantDetailResponse> {
    assertMatchingId(input.id, id);
    await this.validation.validateUnit(input.unit, 'restaurant');
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(RestaurantEntity);
      const entity = await requireResourceForUpdate(
        repository,
        id,
        ErrorCode.RESTAURANT_NOT_FOUND,
      );
      assertVersion(entity.version, input.version);
      await this.validation.validateCity(input.city, entity.city);
      await ensureCodeAvailable(repository, input.code, id);
      Object.assign(entity, input, { id, updatedBy: actorId });
      const saved = await repository.save(entity);
      const prices = await manager
        .getRepository(RestaurantPriceEntity)
        .findBy({ restaurantId: id });
      return this.toDetailResponse(saved, prices);
    });
  }
  async delete(ids: string[], actorId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(RestaurantEntity);
      const entities = await requireResources(
        repository,
        ids,
        ErrorCode.RESTAURANT_NOT_FOUND,
      );
      const uniqueIds = entities.map((item) => item.id);
      const prices = manager.getRepository(RestaurantPriceEntity);
      await prices
        .createQueryBuilder()
        .update()
        .set({ updatedBy: actorId })
        .where('restaurant_id IN (:...ids)', { ids: uniqueIds })
        .andWhere('deleted_at IS NULL')
        .execute();
      await prices.softDelete({ restaurantId: In(uniqueIds) });
      await repository
        .createQueryBuilder()
        .update()
        .set({ updatedBy: actorId })
        .whereInIds(uniqueIds)
        .execute();
      await repository.softDelete(uniqueIds);
    });
  }
  async listPrices(restaurantId: string): Promise<RestaurantPriceResponse[]> {
    await requireResource(
      this.restaurants,
      restaurantId,
      ErrorCode.RESTAURANT_NOT_FOUND,
    );
    return (
      await this.prices.find({
        where: { restaurantId },
        order: { createdAt: 'ASC', id: 'ASC' },
      })
    ).map((item) => this.toPriceResponse(item));
  }
  async createPrice(
    restaurantId: string,
    input: CreateRestaurantPriceDto,
    actorId: string,
  ): Promise<RestaurantPriceResponse> {
    return this.dataSource.transaction(async (manager) => {
      await requireResource(
        manager.getRepository(RestaurantEntity),
        restaurantId,
        ErrorCode.RESTAURANT_NOT_FOUND,
      );
      await this.validation.validateUnit(input.unit, 'restaurant');
      const repository = manager.getRepository(RestaurantPriceEntity);
      return this.toPriceResponse(
        await repository.save(
          repository.create({
            ...input,
            restaurantId,
            price: normalizeMoney(input.price),
            dinerCount: normalizeNullable(input.dinerCount),
            createdBy: actorId,
            updatedBy: actorId,
          }),
        ),
      );
    });
  }
  async updatePrice(
    restaurantId: string,
    priceId: string,
    input: UpdateRestaurantPriceDto,
    actorId: string,
  ): Promise<RestaurantPriceResponse> {
    assertMatchingId(input.id, priceId);
    return this.dataSource.transaction(async (manager) => {
      await requireResource(
        manager.getRepository(RestaurantEntity),
        restaurantId,
        ErrorCode.RESTAURANT_NOT_FOUND,
      );
      await this.validation.validateUnit(input.unit, 'restaurant');
      const repository = manager.getRepository(RestaurantPriceEntity);
      const entity = await repository.findOne({
        where: { id: priceId, restaurantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!entity)
        throw new BusinessException({
          code: ErrorCode.RESTAURANT_PRICE_NOT_FOUND,
          message: 'Price was not found for this restaurant',
          status: HttpStatus.NOT_FOUND,
        });
      assertVersion(entity.version, input.version);
      Object.assign(entity, input, {
        id: priceId,
        restaurantId,
        price: normalizeMoney(input.price),
        dinerCount: normalizeNullable(input.dinerCount),
        updatedBy: actorId,
      });
      return this.toPriceResponse(await repository.save(entity));
    });
  }
  async deletePrices(
    restaurantId: string,
    ids: string[],
    actorId: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await requireResource(
        manager.getRepository(RestaurantEntity),
        restaurantId,
        ErrorCode.RESTAURANT_NOT_FOUND,
      );
      const uniqueIds = [...new Set(ids)];
      const repository = manager.getRepository(RestaurantPriceEntity);
      const entities = await repository.findBy({
        restaurantId,
        id: In(uniqueIds),
      });
      assertAllFound(
        uniqueIds,
        entities.map((item) => item.id),
        ErrorCode.RESTAURANT_PRICE_NOT_FOUND,
      );
      await repository
        .createQueryBuilder()
        .update()
        .set({ updatedBy: actorId })
        .where('restaurant_id = :restaurantId', { restaurantId })
        .andWhere('id IN (:...ids)', { ids: uniqueIds })
        .execute();
      await repository.softDelete({ restaurantId, id: In(uniqueIds) });
    });
  }
  private toListResponse(entity: RestaurantEntity): RestaurantListItemResponse {
    return {
      ...auditResponse(entity),
      code: entity.code,
      name: entity.name,
      city: entity.city,
      cuisine: entity.cuisine,
      contact: entity.contact,
      phone: entity.phone,
      address: entity.address,
      remark: entity.remark,
      unit: entity.unit,
      status: entity.status,
      priceCount: Number(
        (entity as RestaurantEntity & { priceCount?: number }).priceCount ?? 0,
      ),
    };
  }
  private toDetailResponse(
    entity: RestaurantEntity,
    prices: RestaurantPriceEntity[],
  ): RestaurantDetailResponse {
    return {
      ...this.toListResponse(entity),
      priceCount: prices.length,
      prices: prices.map((item) => this.toPriceResponse(item)),
    };
  }
  private toPriceResponse(
    entity: RestaurantPriceEntity,
  ): RestaurantPriceResponse {
    return {
      ...auditResponse(entity),
      restaurantId: entity.restaurantId,
      menuName: entity.menuName,
      dishDetails: entity.dishDetails,
      unit: entity.unit,
      price: normalizeMoney(entity.price),
      dinerCount: entity.dinerCount,
      remark: entity.remark,
    };
  }
}
