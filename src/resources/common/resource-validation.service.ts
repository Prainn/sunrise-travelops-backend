import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ErrorCode } from '../../common/constants/error-code';
import { BusinessDictionaryItemEntity } from '../../system/business-dictionaries/business-dictionary-item.entity';
import { BusinessDictionaryStatus } from '../../system/business-dictionaries/business-dictionary-status';
import { BusinessResourceType } from '../../system/business-dictionaries/business-dictionary-status';
import { BusinessDictionaryTypeEntity } from '../../system/business-dictionaries/business-dictionary-type.entity';
import { SupplierEntity } from '../suppliers/supplier.entity';
import { ResourceStatus } from './resource.constants';

@Injectable()
export class ResourceValidationService {
  constructor(
    @InjectRepository(BusinessDictionaryTypeEntity)
    private readonly dictionaryTypes: Repository<BusinessDictionaryTypeEntity>,
    @InjectRepository(BusinessDictionaryItemEntity)
    private readonly dictionaryItems: Repository<BusinessDictionaryItemEntity>,
    @InjectRepository(SupplierEntity)
    private readonly suppliers: Repository<SupplierEntity>,
  ) {}

  async validateUnit(unit: string, resourceType: string): Promise<void> {
    const type = await this.dictionaryTypes.findOneBy({
      code: 'resource-unit',
    });
    const item = type
      ? await this.dictionaryItems.findOneBy({
          typeId: type.id,
          code: unit,
          status: BusinessDictionaryStatus.Enabled,
        })
      : null;
    if (
      !item ||
      !item.resourceTypes.includes(resourceType as BusinessResourceType)
    ) {
      throw new BusinessException({
        code: ErrorCode.RESOURCE_UNIT_INVALID,
        message:
          'The resource unit does not exist, is disabled, or is not applicable',
        status: HttpStatus.BAD_REQUEST,
        details: { unit, resourceType },
      });
    }
  }

  async validateGroundOperator(
    provided: boolean,
    groundOperatorId?: string | null,
  ): Promise<string | null> {
    if (!provided) return null;
    if (!groundOperatorId) {
      throw new BusinessException({
        code: ErrorCode.GROUND_OPERATOR_REQUIRED,
        message: 'A ground operator is required',
        status: HttpStatus.BAD_REQUEST,
      });
    }
    const supplier = await this.suppliers.findOneBy({
      id: groundOperatorId,
      status: ResourceStatus.Enabled,
    });
    if (!supplier) {
      throw new BusinessException({
        code: ErrorCode.GROUND_OPERATOR_NOT_FOUND_OR_DISABLED,
        message: 'Ground operator was not found or is disabled',
        status: HttpStatus.BAD_REQUEST,
        details: { groundOperatorId },
      });
    }
    return groundOperatorId;
  }
}
