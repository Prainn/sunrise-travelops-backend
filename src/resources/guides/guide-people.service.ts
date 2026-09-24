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
  CreateGuidePersonDto,
  GuidePersonQueryDto,
  GuidePersonResponse,
  UpdateGuidePersonDto,
} from './dto/guide-person.dto';
import { GuidePersonEntity } from './guide-person.entity';

function nullableDocument(value: string | null | undefined): string | null {
  return value === '' || value == null ? null : value;
}

@Injectable()
export class GuidePeopleService {
  constructor(
    @InjectRepository(GuidePersonEntity)
    private readonly people: Repository<GuidePersonEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async list(
    query: GuidePersonQueryDto,
  ): Promise<PageResult<GuidePersonResponse>> {
    const page = actualPage(query);
    const builder = this.people
      .createQueryBuilder('person')
      .orderBy("CAST(SUBSTRING(person.code FROM '[0-9]+$') AS bigint)", 'ASC')
      .addOrderBy('person.code', 'ASC')
      .addOrderBy('person.id', 'ASC')
      .skip((page - 1) * query.pageSize)
      .take(query.pageSize);
    scopeResources(builder, 'person');
    const keyword = actualKeyword(query);
    if (keyword)
      builder.andWhere(
        '(person.code ILIKE :keyword OR person.name ILIKE :keyword OR person.contact ILIKE :keyword OR person.certificateNo ILIKE :keyword OR person.identityNumber ILIKE :keyword)',
        { keyword: `%${keyword}%` },
      );
    if (query.status)
      builder.andWhere('person.status = :status', { status: query.status });
    const [entities, total] = await builder.getManyAndCount();
    return {
      list: entities.map((item) => this.toResponse(item)),
      total,
      page,
      pageSize: query.pageSize,
    };
  }

  async get(id: string): Promise<GuidePersonResponse> {
    return this.toResponse(
      await requireResource(this.people, id, ErrorCode.RESOURCE_NOT_FOUND),
    );
  }

  async create(
    input: CreateGuidePersonDto,
    actorId: string,
  ): Promise<GuidePersonResponse> {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(GuidePersonEntity);
      const rows: unknown =
        await manager.query(`INSERT INTO business_code_counters(prefix,day,last_value)
        VALUES ('GPR', DATE '0001-01-01', 1)
        ON CONFLICT(prefix,day) DO UPDATE SET last_value = business_code_counters.last_value + 1
        RETURNING last_value`);
      const sequence = (rows as Array<{ last_value: string }>)[0].last_value;
      const code = `GPR-${String(sequence).padStart(3, '0')}`;
      const entity = repository.create({
        ...input,
        library: resourceLibrary(true) ?? undefined,
        code,
        gender: input.gender ?? 0,
        age: input.age ?? null,
        language: nullableDocument(input.language),
        contact: nullableDocument(input.contact),
        employmentType: input.employmentType ?? null,
        hasLaborContract: input.hasLaborContract ?? null,
        remark: nullableDocument(input.remark),
        certificateNo: nullableDocument(input.certificateNo),
        identityNumber: nullableDocument(input.identityNumber),
        createdBy: actorId,
        updatedBy: actorId,
      });
      return this.toResponse(await repository.save(entity));
    });
  }

  async update(
    id: string,
    input: UpdateGuidePersonDto,
    actorId: string,
  ): Promise<GuidePersonResponse> {
    assertMatchingId(input.id, id);
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(GuidePersonEntity);
      const entity = await requireResourceForUpdate(
        repository,
        id,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
      assertVersion(entity.version, input.version);
      Object.assign(entity, input, {
        id,
        library: entity.library,
        code: entity.code,
        gender: input.gender ?? 0,
        age: input.age === undefined ? entity.age : input.age,
        language:
          input.language === undefined
            ? entity.language
            : nullableDocument(input.language),
        contact:
          input.contact === undefined
            ? entity.contact
            : nullableDocument(input.contact),
        employmentType:
          input.employmentType === undefined
            ? entity.employmentType
            : input.employmentType,
        hasLaborContract:
          input.hasLaborContract === undefined
            ? entity.hasLaborContract
            : input.hasLaborContract,
        remark:
          input.remark === undefined
            ? entity.remark
            : nullableDocument(input.remark),
        certificateNo:
          input.certificateNo === undefined
            ? entity.certificateNo
            : nullableDocument(input.certificateNo),
        identityNumber:
          input.identityNumber === undefined
            ? entity.identityNumber
            : nullableDocument(input.identityNumber),
        updatedBy: actorId,
      });
      return this.toResponse(await repository.save(entity));
    });
  }

  async delete(ids: string[], actorId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(GuidePersonEntity);
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

  private toResponse(entity: GuidePersonEntity): GuidePersonResponse {
    return {
      ...auditResponse(entity),
      library: entity.library,
      code: entity.code,
      name: entity.name,
      gender: entity.gender,
      age: entity.age,
      language: entity.language,
      contact: entity.contact,
      employmentType: entity.employmentType,
      hasLaborContract: entity.hasLaborContract,
      remark: entity.remark,
      certificateNo: entity.certificateNo,
      identityNumber: entity.identityNumber,
      status: entity.status,
    };
  }
}
