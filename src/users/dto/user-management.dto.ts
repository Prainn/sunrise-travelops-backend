import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const toDateRange = ({ value }: { value: unknown }): unknown => {
  if (Array.isArray(value)) return value;
  return typeof value === 'string'
    ? value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : value;
};

export class UserQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: [0, 1] })
  @IsOptional()
  @Type(() => Number)
  @IsIn([0, 1])
  status?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  deptId?: number;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  roleId?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['2026-08-01', '2026-08-31'],
  })
  @IsOptional()
  @Transform(toDateRange)
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  @IsDateString({}, { each: true })
  createTime?: string[];
}

class UserEditableFieldsDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  id?: string;

  @ApiProperty({ example: '李明' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  nickname: string;

  @ApiPropertyOptional({ default: '' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  avatar = '';

  @ApiPropertyOptional({ enum: [0, 1, 2], default: 0 })
  @Type(() => Number)
  @IsIn([0, 1, 2])
  gender = 0;

  @ApiPropertyOptional({ default: '' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @ValidateIf((_object, value: unknown) => value !== '')
  @Matches(/^1[3-9]\d{9}$/)
  mobile = '';

  @ApiPropertyOptional({ default: '' })
  @IsOptional()
  @Transform(trim)
  @ValidateIf((_object, value: unknown) => value !== '')
  @IsEmail()
  @MaxLength(254)
  email = '';

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  deptId: number;

  @ApiProperty({ type: [String], format: 'uuid' })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  roleIds: string[];

  @ApiPropertyOptional({ enum: [0, 1], default: 1 })
  @Type(() => Number)
  @IsIn([0, 1])
  status = 1;
}

export class CreateUserDto extends UserEditableFieldsDto {
  @ApiProperty({ example: 'operations_li' })
  @Transform(trim)
  @Matches(/^[a-z][a-z0-9_.-]{2,79}$/)
  username: string;

  @ApiPropertyOptional({ minLength: 6, maxLength: 128 })
  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(128)
  password?: string;
}

export class UpdateUserDto extends UserEditableFieldsDto {
  @ApiPropertyOptional({
    example: 'operations_li',
    description: 'Optional compatibility field; it cannot be changed',
  })
  @IsOptional()
  @Transform(trim)
  @Matches(/^[a-z][a-z0-9_.-]{2,79}$/)
  username?: string;
}

export class ResetUserPasswordDto {
  @ApiProperty({ minLength: 6, maxLength: 128 })
  @IsString()
  @MinLength(6)
  @MaxLength(128)
  password: string;
}

export class UserBatchIdsQueryDto {
  @ApiProperty({ type: [String], format: 'uuid' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean)
      : value,
  )
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  ids: string[];
}

export class UserItemResponse {
  id: string;
  username: string;
  nickname: string;
  avatar: string;
  gender: number;
  mobile: string;
  email: string;
  deptId: number | null;
  deptName: string;
  roleIds: string[];
  roleNames: string;
  status: number;
  createTime: string;
}

export class CreatedUserResponse extends UserItemResponse {
  temporaryPassword?: string;
}
