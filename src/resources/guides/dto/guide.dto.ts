import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Matches,
  Min,
} from 'class-validator';
import {
  ResourceAuditResponse,
  ResourceQueryDto,
  moneyTransform,
} from '../../common/resource.dto';
import { GUIDE_LANGUAGES } from '../guide.entity';
import { ResourceStatus } from '../../common/resource.constants';
export class GuideQueryDto extends ResourceQueryDto {
  @IsOptional() @IsIn(GUIDE_LANGUAGES) secondLanguage?: string;
  @IsOptional() @IsIn(['true', 'false']) shopping?: string;
}
export class CreateGuideDto {
  @IsOptional() @IsIn(['shengxu', 'shared']) library?: 'shengxu' | 'shared';
  @IsOptional() @IsUUID() id?: string;
  @moneyTransform @Matches(/^\d{1,10}(?:\.\d{1,2})?$/) dailyPrice: string;
  @IsIn(GUIDE_LANGUAGES) secondLanguage: string;
  @IsBoolean() shopping: boolean;
  @IsOptional() @IsEnum(ResourceStatus) status?: ResourceStatus;
}
export class UpdateGuideDto extends CreateGuideDto {
  @Type(() => Number) @IsInt() @Min(1) version: number;
}
export class GuideResponse implements ResourceAuditResponse {
  library: 'shengxu' | 'shared';
  id: string;
  version: number;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
  code: string;
  name: string;
  status: string;
  dailyPrice: string;
  secondLanguage: string;
  shopping: boolean;
}
export class GuideListItemResponse extends GuideResponse {}
export class GuideDetailResponse extends GuideResponse {}
