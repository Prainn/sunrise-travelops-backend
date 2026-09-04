import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { PageResult } from '../../common/types/page-result';
import { ApplicationError } from '../../common/errors/application-error';
import { SupplierEntity } from './supplier.entity';
import {
  CreateSupplierDto,
  SupplierOptionResponse,
  SupplierQueryDto,
  SupplierResponse,
  UpdateSupplierDto,
} from './dto/supplier.dto';
import { RestaurantPriceEntity } from '../restaurants/restaurant.entity';
import { AttractionPriceEntity } from '../attractions/attraction.entity';
import { GuideEntity } from '../guides/guide.entity';
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
import { ResourceStatus } from '../common/resource.constants';

@Injectable()
export class SuppliersService {
  constructor(
    @InjectRepository(SupplierEntity)
    private readonly suppliers: Repository<SupplierEntity>,
    private readonly dataSource: DataSource,
  ) {}
  async list(query: SupplierQueryDto): Promise<PageResult<SupplierResponse>> {
    const page = actualPage(query);
    const builder = this.suppliers
      .createQueryBuilder('supplier')
      .orderBy('supplier.createdAt', 'DESC')
      .addOrderBy('supplier.id', 'ASC')
      .skip((page - 1) * query.pageSize)
      .take(query.pageSize);
    const keyword = actualKeyword(query);
    if (keyword)
      builder.andWhere(
        '(supplier.code ILIKE :keyword OR supplier.name ILIKE :keyword OR supplier.city ILIKE :keyword OR supplier.contact ILIKE :keyword OR supplier.phone ILIKE :keyword)',
        { keyword: `%${keyword}%` },
      );
    if (query.status)
      builder.andWhere('supplier.status = :status', { status: query.status });
    const [entities, total] = await builder.getManyAndCount();
    return {
      list: entities.map((item) => this.toResponse(item)),
      total,
      page,
      pageSize: query.pageSize,
    };
  }
  async options(): Promise<SupplierOptionResponse[]> {
    return (
      await this.suppliers.find({
        where: { status: ResourceStatus.Enabled },
        order: { name: 'ASC', id: 'ASC' },
      })
    ).map(({ id, code, name }) => ({ id, code, name }));
  }
  async get(id: string): Promise<SupplierResponse> {
    return this.toResponse(
      await requireResource(this.suppliers, id, 'SUPPLIER_NOT_FOUND'),
    );
  }
  async create(
    input: CreateSupplierDto,
    actorId: string,
  ): Promise<SupplierResponse> {
    await ensureCodeAvailable(this.suppliers, input.code);
    return this.toResponse(
      await this.suppliers.save(
        this.suppliers.create({
          ...input,
          createdBy: actorId,
          updatedBy: actorId,
        }),
      ),
    );
  }
  async update(
    id: string,
    input: UpdateSupplierDto,
    actorId: string,
  ): Promise<SupplierResponse> {
    assertMatchingId(input.id, id);
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(SupplierEntity);
      const entity = await requireResourceForUpdate(
        repository,
        id,
        'SUPPLIER_NOT_FOUND',
      );
      assertVersion(entity.version, input.version);
      await ensureCodeAvailable(repository, input.code, id);
      Object.assign(entity, input, { id, updatedBy: actorId });
      return this.toResponse(await repository.save(entity));
    });
  }
  async delete(ids: string[], actorId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(SupplierEntity);
      const entities = await requireResources(
        repository,
        ids,
        'SUPPLIER_NOT_FOUND',
      );
      const uniqueIds = entities.map((item) => item.id);
      const references = [
        {
          type: 'restaurantPrice',
          count: await manager
            .getRepository(RestaurantPriceEntity)
            .createQueryBuilder('price')
            .where('price.groundOperatorId IN (:...ids)', { ids: uniqueIds })
            .getCount(),
        },
        {
          type: 'attractionPrice',
          count: await manager
            .getRepository(AttractionPriceEntity)
            .createQueryBuilder('price')
            .where('price.groundOperatorId IN (:...ids)', { ids: uniqueIds })
            .getCount(),
        },
        {
          type: 'guide',
          count: await manager
            .getRepository(GuideEntity)
            .createQueryBuilder('guide')
            .where('guide.groundOperatorId IN (:...ids)', { ids: uniqueIds })
            .getCount(),
        },
      ];
      const used = references.filter((reference) => reference.count > 0);
      if (used.length)
        throw new ApplicationError(
          'RESOURCE_IN_USE',
          'Supplier is referenced by active resource data',
          HttpStatus.CONFLICT,
          { references: used },
        );
      await repository
        .createQueryBuilder()
        .update()
        .set({ updatedBy: actorId })
        .whereInIds(uniqueIds)
        .execute();
      await repository.softDelete(uniqueIds);
    });
  }
  private toResponse(entity: SupplierEntity): SupplierResponse {
    return {
      ...auditResponse(entity),
      code: entity.code,
      name: entity.name,
      city: entity.city,
      countryOrRegion: entity.countryOrRegion,
      contact: entity.contact,
      email: entity.email,
      phone: entity.phone,
      status: entity.status,
      remark: entity.remark,
    };
  }
}
