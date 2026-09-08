import { nextBusinessCode } from '../../common/business-code';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ErrorCode } from '../../common/constants/error-code';
import { PageResult } from '../../common/types/page-result';
import { GuideEntity } from './guide.entity';
import {
  CreateGuideDto,
  GuideQueryDto,
  GuideResponse,
  UpdateGuideDto,
} from './dto/guide.dto';
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
export class GuidesService {
  constructor(
    @InjectRepository(GuideEntity)
    private readonly guides: Repository<GuideEntity>,
    private readonly validation: ResourceValidationService,
    private readonly dataSource: DataSource,
  ) {}
  async list(query: GuideQueryDto): Promise<PageResult<GuideResponse>> {
    const page = actualPage(query);
    const builder = this.guides
      .createQueryBuilder('guide')
      .orderBy('guide.createdAt', 'DESC')
      .addOrderBy('guide.id', 'ASC')
      .skip((page - 1) * query.pageSize)
      .take(query.pageSize);
    const keyword = actualKeyword(query);
    if (keyword)
      builder.andWhere(
        '(guide.code ILIKE :keyword OR guide.certificateNo ILIKE :keyword OR guide.name ILIKE :keyword OR guide.phone ILIKE :keyword OR guide.identityNumber ILIKE :keyword)',
        { keyword: `%${keyword}%` },
      );
    if (query.status)
      builder.andWhere('guide.status = :status', { status: query.status });
    if (query.gender)
      builder.andWhere('guide.gender = :gender', { gender: query.gender });
    if (query.employmentType)
      builder.andWhere('guide.employmentType = :employmentType', {
        employmentType: query.employmentType,
      });
    if (query.language)
      builder.andWhere(':language = ANY(guide.languages)', {
        language: query.language,
      });
    if (query.unit)
      builder.andWhere('guide.unit = :unit', { unit: query.unit });
    const [entities, total] = await builder.getManyAndCount();
    return {
      list: entities.map((item) => this.toResponse(item)),
      total,
      page,
      pageSize: query.pageSize,
    };
  }
  async get(id: string): Promise<GuideResponse> {
    return this.toResponse(
      await requireResource(this.guides, id, ErrorCode.GUIDE_NOT_FOUND),
    );
  }
  async create(input: CreateGuideDto, actorId: string): Promise<GuideResponse> {
    return this.dataSource.transaction(async (manager) => {
      await this.validation.validateUnit(input.unit, 'guide');
      const groundOperatorId = (await this.validation.validateGroundOperator(
        true,
        input.groundOperatorId,
      ))!;
      const repository = manager.getRepository(GuideEntity);
      const code =
        input.code ?? (await nextBusinessCode(repository.manager, 'GDE'));
      await ensureCodeAvailable(repository, code);
      return this.toResponse(
        await repository.save(
          repository.create({
            ...input,
            code,
            dailyPrice: normalizeMoney(input.dailyPrice),
            groundOperatorId,
            createdBy: actorId,
            updatedBy: actorId,
          }),
        ),
      );
    });
  }
  async update(
    id: string,
    input: UpdateGuideDto,
    actorId: string,
  ): Promise<GuideResponse> {
    assertMatchingId(input.id, id);
    return this.dataSource.transaction(async (manager) => {
      await this.validation.validateUnit(input.unit, 'guide');
      const groundOperatorId = (await this.validation.validateGroundOperator(
        true,
        input.groundOperatorId,
      ))!;
      const repository = manager.getRepository(GuideEntity);
      const entity = await requireResourceForUpdate(
        repository,
        id,
        ErrorCode.GUIDE_NOT_FOUND,
      );
      assertVersion(entity.version, input.version);
      input.code ??= entity.code;
      await ensureCodeAvailable(repository, input.code, id);
      Object.assign(entity, input, {
        id,
        dailyPrice: normalizeMoney(input.dailyPrice),
        groundOperatorId,
        updatedBy: actorId,
      });
      return this.toResponse(await repository.save(entity));
    });
  }
  async delete(ids: string[], actorId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(GuideEntity);
      const entities = await requireResources(
        repository,
        ids,
        ErrorCode.GUIDE_NOT_FOUND,
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
  private toResponse(entity: GuideEntity): GuideResponse {
    return {
      ...auditResponse(entity),
      code: entity.code,
      certificateNo: entity.certificateNo,
      name: entity.name,
      gender: entity.gender,
      age: entity.age,
      languages: entity.languages,
      employmentType: entity.employmentType,
      identityNumber: entity.identityNumber,
      phone: entity.phone,
      dailyPrice: normalizeMoney(entity.dailyPrice),
      unit: entity.unit,
      hasLaborContract: entity.hasLaborContract,
      groundOperatorId: entity.groundOperatorId,
      licensePhotoUrl: entity.licensePhotoUrl,
      remark: entity.remark,
      status: entity.status,
    };
  }
}
