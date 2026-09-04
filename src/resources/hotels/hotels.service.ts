import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ErrorCode } from '../../common/constants/error-code';
import { PageResult } from '../../common/types/page-result';
import { HotelEntity } from './hotel.entity';
import {
  CreateHotelDto,
  HotelQueryDto,
  HotelResponse,
  UpdateHotelDto,
} from './dto/hotel.dto';
import { ResourceValidationService } from '../common/resource-validation.service';
import {
  actualKeyword,
  actualPage,
  auditResponse,
  normalizeMoney,
} from '../common/resource.dto';
import { assertMatchingId, assertVersion } from '../common/resource-errors';
import {
  ensureCodeAvailable,
  normalizeNullable,
  requireResource,
  requireResourceForUpdate,
  requireResources,
} from '../common/resource-service.helpers';

@Injectable()
export class HotelsService {
  constructor(
    @InjectRepository(HotelEntity)
    private readonly hotels: Repository<HotelEntity>,
    private readonly validation: ResourceValidationService,
    private readonly dataSource: DataSource,
  ) {}
  async list(query: HotelQueryDto): Promise<PageResult<HotelResponse>> {
    const page = actualPage(query);
    const builder = this.hotels
      .createQueryBuilder('hotel')
      .orderBy('hotel.createdAt', 'DESC')
      .addOrderBy('hotel.id', 'ASC')
      .skip((page - 1) * query.pageSize)
      .take(query.pageSize);
    const keyword = actualKeyword(query);
    if (keyword)
      builder.andWhere(
        '(hotel.code ILIKE :keyword OR hotel.name ILIKE :keyword OR hotel.province ILIKE :keyword OR hotel.city ILIKE :keyword OR hotel.basicRoomType ILIKE :keyword)',
        { keyword: `%${keyword}%` },
      );
    if (query.status)
      builder.andWhere('hotel.status = :status', { status: query.status });
    if (query.city)
      builder.andWhere('hotel.city = :city', { city: query.city });
    if (query.unit)
      builder.andWhere('hotel.unit = :unit', { unit: query.unit });
    const [entities, total] = await builder.getManyAndCount();
    return {
      list: entities.map((item) => this.toResponse(item)),
      total,
      page,
      pageSize: query.pageSize,
    };
  }
  async get(id: string): Promise<HotelResponse> {
    return this.toResponse(
      await requireResource(this.hotels, id, ErrorCode.HOTEL_NOT_FOUND),
    );
  }
  async create(input: CreateHotelDto, actorId: string): Promise<HotelResponse> {
    await this.validation.validateUnit(input.unit, 'hotel');
    await ensureCodeAvailable(this.hotels, input.code);
    const entity = this.hotels.create({
      ...input,
      individualPrice: normalizeMoney(input.individualPrice),
      groupPrice:
        input.groupPrice == null ? null : normalizeMoney(input.groupPrice),
      minimumGroupSize: normalizeNullable(input.minimumGroupSize),
      createdBy: actorId,
      updatedBy: actorId,
    });
    return this.toResponse(await this.hotels.save(entity));
  }
  async update(
    id: string,
    input: UpdateHotelDto,
    actorId: string,
  ): Promise<HotelResponse> {
    assertMatchingId(input.id, id);
    await this.validation.validateUnit(input.unit, 'hotel');
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(HotelEntity);
      const entity = await requireResourceForUpdate(
        repository,
        id,
        ErrorCode.HOTEL_NOT_FOUND,
      );
      assertVersion(entity.version, input.version);
      await ensureCodeAvailable(repository, input.code, id);
      Object.assign(entity, input, {
        id,
        individualPrice: normalizeMoney(input.individualPrice),
        groupPrice:
          input.groupPrice == null ? null : normalizeMoney(input.groupPrice),
        minimumGroupSize: normalizeNullable(input.minimumGroupSize),
        updatedBy: actorId,
      });
      return this.toResponse(await repository.save(entity));
    });
  }
  async delete(ids: string[], actorId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(HotelEntity);
      const entities = await requireResources(
        repository,
        ids,
        ErrorCode.HOTEL_NOT_FOUND,
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
  private toResponse(entity: HotelEntity): HotelResponse {
    return {
      ...auditResponse(entity),
      code: entity.code,
      name: entity.name,
      province: entity.province,
      city: entity.city,
      rating: entity.rating,
      facilities: entity.facilities,
      breakfast: entity.breakfast,
      address: entity.address,
      phone: entity.phone,
      nearby: entity.nearby,
      basicRoomType: entity.basicRoomType,
      individualPrice: normalizeMoney(entity.individualPrice),
      groupPrice:
        entity.groupPrice === null ? null : normalizeMoney(entity.groupPrice),
      minimumGroupSize: entity.minimumGroupSize,
      unit: entity.unit,
      status: entity.status,
    };
  }
}
