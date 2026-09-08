import { nextBusinessCode } from '../../common/business-code';
import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ErrorCode } from '../../common/constants/error-code';
import { PageResult } from '../../common/types/page-result';
import { CityEntity } from './city.entity';
import {
  CreateCityDto,
  CityQueryDto,
  CityResponse,
  UpdateCityDto,
} from './dto/city.dto';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ResourceStatus } from '../common/resource.constants';
import {
  actualKeyword,
  actualPage,
  auditResponse,
} from '../common/resource.dto';
import { assertMatchingId, assertVersion } from '../common/resource-errors';
import {
  ensureCodeAvailable,
  requireResource,
  requireResourceForUpdate,
  requireResources,
} from '../common/resource-service.helpers';

@Injectable()
export class CitiesService {
  constructor(
    @InjectRepository(CityEntity)
    private readonly cities: Repository<CityEntity>,
    private readonly dataSource: DataSource,
  ) {}
  async list(query: CityQueryDto): Promise<PageResult<CityResponse>> {
    const page = actualPage(query);
    const builder = this.cities
      .createQueryBuilder('city')
      .orderBy('city.createdAt', 'DESC')
      .addOrderBy('city.id', 'ASC')
      .skip((page - 1) * query.pageSize)
      .take(query.pageSize);
    const keyword = actualKeyword(query);
    if (keyword)
      builder.andWhere(
        '(city.code ILIKE :keyword OR city.name ILIKE :keyword OR city.province ILIKE :keyword)',
        { keyword: `%${keyword}%` },
      );
    if (query.status)
      builder.andWhere('city.status = :status', { status: query.status });
    const [entities, total] = await builder.getManyAndCount();
    return {
      list: entities.map((item) => this.toResponse(item)),
      total,
      page,
      pageSize: query.pageSize,
    };
  }
  async options(): Promise<CityResponse[]> {
    const entities = await this.cities.find({
      where: { status: ResourceStatus.Enabled },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    return entities.map((entity) => this.toResponse(entity));
  }
  async get(id: string): Promise<CityResponse> {
    return this.toResponse(
      await requireResource(this.cities, id, ErrorCode.RESOURCE_NOT_FOUND),
    );
  }
  async create(input: CreateCityDto, actorId: string): Promise<CityResponse> {
    const code =
      input.code ?? (await nextBusinessCode(this.cities.manager, 'CITY'));
    await ensureCodeAvailable(this.cities, code);
    const entity = this.cities.create({
      ...input,
      code,
      createdBy: actorId,
      updatedBy: actorId,
    });
    return this.toResponse(await this.cities.save(entity));
  }
  async update(
    id: string,
    input: UpdateCityDto,
    actorId: string,
  ): Promise<CityResponse> {
    assertMatchingId(input.id, id);
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(CityEntity);
      const entity = await requireResourceForUpdate(
        repository,
        id,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
      assertVersion(entity.version, input.version);
      if (entity.name !== input.name)
        throw new BusinessException({
          code: ErrorCode.CONFLICT,
          message: '城市名称创建后不可修改，请停用后新增城市',
          status: HttpStatus.CONFLICT,
        });
      input.code ??= entity.code;
      await ensureCodeAvailable(repository, input.code, id);
      Object.assign(entity, input, {
        id,
        updatedBy: actorId,
      });
      return this.toResponse(await repository.save(entity));
    });
  }
  async delete(ids: string[], actorId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(CityEntity);
      const entities = await requireResources(
        repository,
        ids,
        ErrorCode.RESOURCE_NOT_FOUND,
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
  private toResponse(entity: CityEntity): CityResponse {
    return {
      ...auditResponse(entity),
      code: entity.code,
      name: entity.name,
      province: entity.province,
      status: entity.status,
    };
  }
}
