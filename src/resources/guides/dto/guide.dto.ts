import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  GUIDE_EMPLOYMENT_TYPES,
  GUIDE_GENDERS,
  GuideEmploymentType,
  GuideGender,
} from '../../common/resource.constants';
import {
  ResourceAuditResponse,
  ResourceInputDto,
  ResourceQueryDto,
  moneyTransform,
  optionalTrimmedString,
} from '../../common/resource.dto';

export class GuideQueryDto extends ResourceQueryDto {
  @IsOptional() @IsIn(GUIDE_GENDERS) gender?: GuideGender;
  @IsOptional()
  @IsIn(GUIDE_EMPLOYMENT_TYPES)
  employmentType?: GuideEmploymentType;
  @IsOptional() @optionalTrimmedString @IsString() language?: string;
  @IsOptional() @optionalTrimmedString @IsString() unit?: string;
}
export class CreateGuideDto extends ResourceInputDto {
  @optionalTrimmedString @IsString() @MaxLength(100) certificateNo: string;
  @IsIn(GUIDE_GENDERS) gender: GuideGender;
  @Type(() => Number) @IsInt() @Min(1) @Max(130) age: number;
  @Transform(({ value }: { value: unknown }): unknown => {
    if (!Array.isArray(value)) return value;
    return (value as unknown[])
      .map((item): unknown => (typeof item === 'string' ? item.trim() : item))
      .filter((item): boolean => Boolean(item));
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  languages: string[];
  @IsIn(GUIDE_EMPLOYMENT_TYPES) employmentType: GuideEmploymentType;
  @optionalTrimmedString @IsString() @MaxLength(100) identityNumber: string;
  @optionalTrimmedString @IsString() @MaxLength(50) phone: string;
  @IsOptional()
  @moneyTransform
  @Matches(/^\d{1,10}(?:\.\d{1,2})?$/)
  dailyPrice?: string | null;
  @optionalTrimmedString @IsString() @MaxLength(100) unit: string;
  @IsBoolean() hasLaborContract: boolean;
  @IsBoolean() isGroundOperatorProvided: boolean;
  @ValidateIf((input: CreateGuideDto) => input.isGroundOperatorProvided)
  @IsUUID('all')
  groundOperatorId?: string | null;
  @optionalTrimmedString @IsString() licensePhotoUrl: string;
  @optionalTrimmedString @IsString() remark: string;
}
export class UpdateGuideDto extends CreateGuideDto {
  @Type(() => Number) @IsInt() @Min(1) version: number;
}
export class GuideResponse implements ResourceAuditResponse {
  id: string;
  version: number;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
  code: string;
  certificateNo: string;
  name: string;
  gender: GuideGender;
  age: number;
  languages: string[];
  employmentType: GuideEmploymentType;
  identityNumber: string;
  phone: string;
  dailyPrice: string | null;
  unit: string;
  hasLaborContract: boolean;
  isGroundOperatorProvided: boolean;
  groundOperatorId: string | null;
  licensePhotoUrl: string;
  remark: string;
  status: string;
}
export class GuideListItemResponse extends GuideResponse {}
export class GuideDetailResponse extends GuideResponse {}
