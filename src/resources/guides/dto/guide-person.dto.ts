import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  ResourceAuditResponse,
  ResourceQueryDto,
  optionalTrimmedString,
} from '../../common/resource.dto';
import { ResourceStatus } from '../../common/resource.constants';

export class GuidePersonQueryDto extends ResourceQueryDto {}

export class CreateGuidePersonDto {
  @IsOptional() @IsIn(['shengxu', 'shared']) library?: 'shengxu' | 'shared';
  @IsOptional() @IsUUID('all') id?: string;
  @optionalTrimmedString
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name: string;
  @ApiPropertyOptional({ type: Number, enum: [0, 1, 2], nullable: true })
  @IsOptional()
  @IsIn([0, 1, 2])
  gender?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  age?: number | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  language?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  contact?: string | null;
  @ApiPropertyOptional({
    type: String,
    enum: ['full_time', 'part_time'],
    nullable: true,
  })
  @IsOptional()
  @IsIn(['full_time', 'part_time'])
  employmentType?: 'full_time' | 'part_time' | null;
  @ApiPropertyOptional({ type: Boolean, nullable: true })
  @IsOptional()
  @IsBoolean()
  hasLaborContract?: boolean | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  remark?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  certificateNo?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  identityNumber?: string | null;
  @IsEnum(ResourceStatus) status: ResourceStatus;
}

export class UpdateGuidePersonDto extends CreateGuidePersonDto {
  @Type(() => Number) @IsInt() @Min(1) version: number;
}

export class GuidePersonResponse implements ResourceAuditResponse {
  library: 'shengxu' | 'shared';
  id: string;
  code: string;
  name: string;
  @ApiProperty({ type: Number, enum: [0, 1, 2] })
  gender: number;
  @ApiProperty({ type: Number, nullable: true, minimum: 0 })
  age: number | null;
  @ApiProperty({ type: String, nullable: true })
  language: string | null;
  @ApiProperty({ type: String, nullable: true })
  contact: string | null;
  @ApiProperty({
    type: String,
    enum: ['full_time', 'part_time'],
    nullable: true,
  })
  employmentType: 'full_time' | 'part_time' | null;
  @ApiProperty({ type: Boolean, nullable: true })
  hasLaborContract: boolean | null;
  @ApiProperty({ type: String, nullable: true })
  remark: string | null;
  @ApiProperty({ type: String, nullable: true })
  certificateNo: string | null;
  @ApiProperty({ type: String, nullable: true })
  identityNumber: string | null;
  status: ResourceStatus;
  version: number;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
}
