import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { ErrorCode } from '../../common/constants/error-code';
import { PageResult } from '../../common/types/page-result';
import {
  actualKeyword,
  actualPage,
  auditResponse,
} from '../common/resource.dto';
import { requireDictionaryItem } from '../../common/dictionary-items';
import { assertMatchingId, assertVersion } from '../common/resource-errors';
import {
  requireResource,
  requireResourceForUpdate,
  requireResources,
} from '../common/resource-service.helpers';
import { resourceLibrary, scopeResources } from '../common/resource-scope';
import {
  AirportLabel,
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
        `(flight.departureCity ILIKE :keyword OR flight.arrivalCity ILIKE :keyword OR flight.flightNumber ILIKE :keyword
          OR EXISTS (SELECT 1 FROM system_business_dictionary_items airport
            WHERE airport.id IN (flight.departure_airport_id, flight.arrival_airport_id)
              AND (airport.code ILIKE :keyword OR airport.name ILIKE :keyword OR airport.english_name ILIKE :keyword)))`,
        { keyword: `%${keyword}%` },
      );
    if (query.status)
      builder.andWhere('flight.status = :status', { status: query.status });
    if (query.departureAirportId)
      builder.andWhere('flight.departureAirportId = :departureAirportId', {
        departureAirportId: query.departureAirportId,
      });
    if (query.arrivalAirportId)
      builder.andWhere('flight.arrivalAirportId = :arrivalAirportId', {
        arrivalAirportId: query.arrivalAirportId,
      });
    const [entities, total] = await builder.getManyAndCount();
    const labels = await this.airportLabels(entities);
    return {
      list: entities.map((entity) => this.toResponse(entity, labels)),
      total,
      page,
      pageSize: query.pageSize,
    };
  }

  async get(id: string): Promise<FlightResponse> {
    const entity = await requireResource(
      this.flights,
      id,
      ErrorCode.RESOURCE_NOT_FOUND,
    );
    return this.toResponse(entity, await this.airportLabels([entity]));
  }

  async create(
    input: CreateFlightDto,
    actorId: string,
  ): Promise<FlightResponse> {
    const [from, to] = await this.airports(this.dataSource.manager, input);
    const entity = this.flights.create({
      ...input,
      departureCity: from.name,
      arrivalCity: to.name,
      library: resourceLibrary(true) ?? undefined,
      createdBy: actorId,
      updatedBy: actorId,
    });
    const saved = await this.flights.save(entity);
    return this.toResponse(saved, await this.airportLabels([saved]));
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
      const [from, to] = await this.airports(manager, input);
      Object.assign(entity, input, {
        id,
        departureCity: from.name,
        arrivalCity: to.name,
        library: entity.library,
        updatedBy: actorId,
      });
      const saved = await repository.save(entity);
      return this.toResponse(saved, await this.airportLabels([saved]));
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

  private async airports(
    manager: EntityManager,
    input: CreateFlightDto,
  ): Promise<[{ name: string }, { name: string }]> {
    const from = await requireDictionaryItem(
      manager,
      'city-airport',
      input.departureAirportId,
    );
    const to = await requireDictionaryItem(
      manager,
      'city-airport',
      input.arrivalAirportId,
    );
    return [from, to];
  }

  private async airportLabels(
    entities: FlightEntity[],
  ): Promise<Map<string, AirportLabel>> {
    const ids = [
      ...new Set(
        entities.flatMap((e) => [e.departureAirportId, e.arrivalAirportId]),
      ),
    ].filter((id): id is string => !!id);
    if (!ids.length) return new Map();
    const rows: (AirportLabel & { id: string })[] = await this.dataSource.query(
      `SELECT id, code, name, english_name AS "englishName" FROM system_business_dictionary_items WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    return new Map(rows.map((row) => [row.id, row]));
  }

  private toResponse(
    entity: FlightEntity,
    labels: Map<string, AirportLabel>,
  ): FlightResponse {
    return {
      ...auditResponse(entity),
      library: entity.library,
      departureAirportId: entity.departureAirportId,
      arrivalAirportId: entity.arrivalAirportId,
      departureAirport: labels.get(entity.departureAirportId ?? '') ?? null,
      arrivalAirport: labels.get(entity.arrivalAirportId ?? '') ?? null,
      departureCity: entity.departureCity,
      arrivalCity: entity.arrivalCity,
      flightNumber: entity.flightNumber,
      departureTime: entity.departureTime,
      arrivalTime: entity.arrivalTime,
      status: entity.status,
    };
  }
}
