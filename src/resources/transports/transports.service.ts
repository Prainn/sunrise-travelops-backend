import { nextBusinessCode } from '../../common/business-code';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ErrorCode } from '../../common/constants/error-code';
import { PageResult } from '../../common/types/page-result';
import { TransportEntity } from './transport.entity';
import {
  CreateTransportDto,
  TransportQueryDto,
  TransportResponse,
  UpdateTransportDto,
} from './dto/transport.dto';
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
  requireResource,
  requireResourceForUpdate,
  requireResources,
} from '../common/resource-service.helpers';

@Injectable()
export class TransportsService {
  constructor(
    @InjectRepository(TransportEntity)
    private readonly transports: Repository<TransportEntity>,
    private readonly validation: ResourceValidationService,
    private readonly dataSource: DataSource,
  ) {}
  async list(query: TransportQueryDto): Promise<PageResult<TransportResponse>> {
    const page = actualPage(query);
    const builder = this.transports
      .createQueryBuilder('transport')
      .orderBy('transport.createdAt', 'DESC')
      .addOrderBy('transport.id', 'ASC')
      .skip((page - 1) * query.pageSize)
      .take(query.pageSize);
    const keyword = actualKeyword(query);
    if (keyword)
      builder.andWhere(
        '(transport.code ILIKE :keyword OR transport.name ILIKE :keyword OR transport.city ILIKE :keyword)',
        { keyword: `%${keyword}%` },
      );
    if (query.status)
      builder.andWhere('transport.status = :status', { status: query.status });
    if (query.city)
      builder.andWhere('transport.city = :city', { city: query.city });
    if (query.serviceLevel)
      builder.andWhere('transport.serviceLevel = :serviceLevel', {
        serviceLevel: query.serviceLevel,
      });
    if (query.unit)
      builder.andWhere('transport.unit = :unit', { unit: query.unit });
    const [entities, total] = await builder.getManyAndCount();
    return {
      list: entities.map((item) => this.toResponse(item)),
      total,
      page,
      pageSize: query.pageSize,
    };
  }
  async get(id: string): Promise<TransportResponse> {
    return this.toResponse(
      await requireResource(this.transports, id, ErrorCode.TRANSPORT_NOT_FOUND),
    );
  }
  async create(
    input: CreateTransportDto,
    actorId: string,
  ): Promise<TransportResponse> {
    await this.validation.validateCity(input.city);
    await this.validation.validateUnit(input.unit, 'vehicle');
    const code =
      input.code ?? (await nextBusinessCode(this.transports.manager, 'VEH'));
    await ensureCodeAvailable(this.transports, code);
    return this.toResponse(
      await this.transports.save(
        this.transports.create({
          ...input,
          code,
          dailyPrice: normalizeMoney(input.dailyPrice),
          createdBy: actorId,
          updatedBy: actorId,
        }),
      ),
    );
  }
  async update(
    id: string,
    input: UpdateTransportDto,
    actorId: string,
  ): Promise<TransportResponse> {
    assertMatchingId(input.id, id);
    await this.validation.validateUnit(input.unit, 'vehicle');
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(TransportEntity);
      const entity = await requireResourceForUpdate(
        repository,
        id,
        ErrorCode.TRANSPORT_NOT_FOUND,
      );
      assertVersion(entity.version, input.version);
      await this.validation.validateCity(input.city, entity.city);
      input.code ??= entity.code;
      await ensureCodeAvailable(repository, input.code, id);
      Object.assign(entity, input, {
        id,
        dailyPrice: normalizeMoney(input.dailyPrice),
        updatedBy: actorId,
      });
      return this.toResponse(await repository.save(entity));
    });
  }
  async delete(ids: string[], actorId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(TransportEntity);
      const entities = await requireResources(
        repository,
        ids,
        ErrorCode.TRANSPORT_NOT_FOUND,
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
  private toResponse(entity: TransportEntity): TransportResponse {
    return {
      ...auditResponse(entity),
      code: entity.code,
      name: entity.name,
      serviceLevel: entity.serviceLevel,
      seats: entity.seats,
      dailyPrice: normalizeMoney(entity.dailyPrice),
      unit: entity.unit,
      city: entity.city,
      phone: entity.phone,
      status: entity.status,
      remark: entity.remark,
    };
  }
}
