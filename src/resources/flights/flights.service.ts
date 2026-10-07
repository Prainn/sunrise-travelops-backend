import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ErrorCode } from '../../common/constants/error-code';
import { PageResult } from '../../common/types/page-result';
import {
  actualKeyword,
  actualPage,
  auditResponse,
} from '../common/resource.dto';
import { assertMatchingId, assertVersion } from '../common/resource-errors';
import {
  requireResource,
  requireResourceForUpdate,
  requireResources,
} from '../common/resource-service.helpers';
import { resourceLibrary, scopeResources } from '../common/resource-scope';
import {
  CreateFlightDto,
  FlightQueryDto,
  FlightResponse,
  UpdateFlightDto,
} from './dto/flight.dto';
import { FlightEntity } from './flight.entity';

@Injectable()
export class FlightsService {
  constructor(
    @InjectRepository(FlightEntity)
    private readonly flights: Repository<FlightEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async list(query: FlightQueryDto): Promise<PageResult<FlightResponse>> {
    const page = actualPage(query);
    const builder = this.flights
      .createQueryBuilder('flight')
      .orderBy('flight.createdAt', 'ASC')
      .addOrderBy('flight.id', 'ASC')
      .skip((page - 1) * query.pageSize)
      .take(query.pageSize);
    scopeResources(builder, 'flight');
    const keyword = actualKeyword(query);
    if (keyword)
      builder.andWhere(
        '(flight.departureCity ILIKE :keyword OR flight.arrivalCity ILIKE :keyword OR flight.flightNumber ILIKE :keyword)',
        { keyword: `%${keyword}%` },
      );
    if (query.status)
      builder.andWhere('flight.status = :status', { status: query.status });
    const [entities, total] = await builder.getManyAndCount();
    return {
      list: entities.map((entity) => this.toResponse(entity)),
      total,
      page,
      pageSize: query.pageSize,
    };
  }

  async get(id: string): Promise<FlightResponse> {
    return this.toResponse(
      await requireResource(this.flights, id, ErrorCode.RESOURCE_NOT_FOUND),
    );
  }

  async create(
    input: CreateFlightDto,
    actorId: string,
  ): Promise<FlightResponse> {
    const entity = this.flights.create({
      ...input,
      library: resourceLibrary(true) ?? undefined,
      createdBy: actorId,
      updatedBy: actorId,
    });
    return this.toResponse(await this.flights.save(entity));
  }

  async update(
    id: string,
    input: UpdateFlightDto,
    actorId: string,
  ): Promise<FlightResponse> {
    assertMatchingId(input.id, id);
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(FlightEntity);
      const entity = await requireResourceForUpdate(
        repository,
        id,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
      assertVersion(entity.version, input.version);
      Object.assign(entity, input, {
        id,
        library: entity.library,
        updatedBy: actorId,
      });
      return this.toResponse(await repository.save(entity));
    });
  }

  async delete(ids: string[], actorId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(FlightEntity);
      const entities = await requireResources(
        repository,
        ids,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
      const uniqueIds = entities.map((entity) => entity.id);
      await repository
        .createQueryBuilder()
        .update()
        .set({ updatedBy: actorId })
        .whereInIds(uniqueIds)
        .execute();
      await repository.softDelete(uniqueIds);
    });
  }

  private toResponse(entity: FlightEntity): FlightResponse {
    return {
      ...auditResponse(entity),
      library: entity.library,
      departureCity: entity.departureCity,
      arrivalCity: entity.arrivalCity,
      flightNumber: entity.flightNumber,
      departureTime: entity.departureTime,
      arrivalTime: entity.arrivalTime,
      status: entity.status,
    };
  }
}
