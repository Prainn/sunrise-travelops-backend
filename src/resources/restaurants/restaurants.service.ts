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
  insertResource,
} from '../common/resource-service.helpers';
import { ResourceValidationService } from '../common/resource-validation.service';
import {
  CreateRestaurantDto,
  RestaurantQueryDto,
  RestaurantResponse,
  UpdateRestaurantDto,
} from './dto/restaurant.dto';
import { RestaurantEntity } from './restaurant.entity';

@Injectable()
export class RestaurantsService {
  constructor(
    @InjectRepository(RestaurantEntity)
    private readonly restaurants: Repository<RestaurantEntity>,
    private readonly validation: ResourceValidationService,
    private readonly dataSource: DataSource,
  ) {}
  async list(
    query: RestaurantQueryDto,
  ): Promise<PageResult<RestaurantResponse>> {
    const page = actualPage(query);
    const builder = this.restaurants
      .createQueryBuilder('restaurant')
      .orderBy(
        "CAST(SUBSTRING(restaurant.code FROM '[0-9]+$') AS bigint)",
        'ASC',
      )
      .addOrderBy('restaurant.code', 'ASC')
      .addOrderBy('restaurant.id', 'ASC')
      .skip((page - 1) * query.pageSize)
      .take(query.pageSize);
    const keyword = actualKeyword(query);
    if (keyword)
      builder.andWhere(
        '(restaurant.code ILIKE :keyword OR restaurant.name ILIKE :keyword OR restaurant.city ILIKE :keyword OR restaurant.description ILIKE :keyword OR restaurant.cuisine ILIKE :keyword)',
        { keyword: `%${keyword}%` },
      );
    if (query.status)
      builder.andWhere('restaurant.status = :status', { status: query.status });
    if (query.city)
      builder.andWhere('restaurant.city = :city', { city: query.city });
    if (query.unit)
      builder.andWhere('restaurant.unit = :unit', { unit: query.unit });
    if (query.isStandardPrice !== undefined)
      builder.andWhere('restaurant.isStandardPrice = :isStandardPrice', {
        isStandardPrice: query.isStandardPrice,
      });
    const [entities, total] = await builder.getManyAndCount();
    return {
      list: entities.map((item) => this.toResponse(item)),
      total,
      page,
      pageSize: query.pageSize,
    };
  }
  async get(id: string): Promise<RestaurantResponse> {
    return this.toResponse(
      await requireResource(
        this.restaurants,
        id,
        ErrorCode.RESTAURANT_NOT_FOUND,
      ),
    );
  }
  async create(
    input: CreateRestaurantDto,
    actorId: string,
  ): Promise<RestaurantResponse> {
    await this.validation.validateCity(input.city, undefined);
    await this.validation.validateUnit(input.unit, 'restaurant');
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(RestaurantEntity);
      const code =
        input.code ?? (await nextBusinessCode(repository.manager, 'RES'));
      await ensureCodeAvailable(repository, code);
      const entity = await insertResource(
        repository,
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
    input: UpdateRestaurantDto,
    actorId: string,
  ): Promise<RestaurantResponse> {
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
      const repository = manager.getRepository(RestaurantEntity);
      const entities = await requireResources(
        repository,
        ids,
        ErrorCode.RESTAURANT_NOT_FOUND,
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
  private fields(input: CreateRestaurantDto) {
    return {
      name: input.name,
      englishName: input.englishName ?? '',
      englishDescription: input.englishDescription ?? '',
      status: input.status,
      city: input.city,
      description: input.description,
      price: normalizeMoney(input.price),
      unit: input.unit,
      // The diner count only has meaning for per-table pricing.
      dinerCount: input.unit === 'table' ? (input.dinerCount ?? null) : null,
      cuisine: input.cuisine ?? '',
      contact: input.contact ?? '',
      phone: input.phone ?? '',
      address: input.address ?? '',
      isStandardPrice: input.isStandardPrice ?? false,
      remark: input.remark ?? '',
    };
  }
  private toResponse(entity: RestaurantEntity): RestaurantResponse {
    return {
      ...auditResponse(entity),
      code: entity.code,
      name: entity.name,
      englishName: entity.englishName,
      englishDescription: entity.englishDescription,
      city: entity.city,
      cuisine: entity.cuisine,
      contact: entity.contact,
      phone: entity.phone,
      address: entity.address,
      description: entity.description,
      isStandardPrice: entity.isStandardPrice,
      remark: entity.remark,
      unit: entity.unit,
      price: entity.price == null ? null : normalizeMoney(entity.price),
      dinerCount: entity.dinerCount,
      status: entity.status,
    };
  }
}
