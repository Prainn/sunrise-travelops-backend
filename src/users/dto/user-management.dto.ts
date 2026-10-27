import { COORDINATOR_DUTIES, CoordinatorDuty } from '../coordinator-assignment';
import { LOGIN_SCOPES, LoginScope } from '../user-identity.entity';
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
  ValidateNested,
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
  @ApiPropertyOptional({
    enum: LOGIN_SCOPES,
    description:
      'Filter accounts by identity scope; retain their full identities',
  })
  @IsOptional()
  @IsIn(LOGIN_SCOPES)
  scope?: LoginScope;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  businessGroupId?: string;
  @ApiPropertyOptional({ enum: COORDINATOR_DUTIES })
  @IsOptional()
  @IsIn(COORDINATOR_DUTIES)
  coordinatorDuty?: CoordinatorDuty;
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

export class TourCodeSuggestionQueryDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  englishName: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  nickname: string;
}

export class TourCodeSuggestionResponse {
  @ApiProperty({ type: String, nullable: true, example: 'EM' })
  tourCode: string | null;
}

export class IdentityInput {
  @ApiPropertyOptional({
    enum: COORDINATOR_DUTIES,
    nullable: true,
    description:
      '仅霖熹、独立站计调可设置，默认 reception；盛旭及非计调传 null 或省略',
  })
  @IsOptional()
  @IsIn(COORDINATOR_DUTIES)
  coordinatorDuty?: CoordinatorDuty | null;
  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: '霖熹必填，其余身份必须为空',
  })
  @IsOptional()
  @IsUUID()
  businessGroupId?: string | null;
  @IsOptional() @IsUUID() id?: string;
  @IsIn(LOGIN_SCOPES) scope: LoginScope;
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
}

class UserEditableFieldsDto {
  @ApiPropertyOptional({ default: '', maxLength: 100 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(trim)
  @IsString()
  @Matches(/^(?:|ou_[A-Za-z0-9_-]{1,97})$/)
  feishuOpenId?: string;

  @ApiProperty({ example: '李明' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  nickname: string;

  @ApiProperty({ example: 'Li Ming' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  englishName: string;

  @ApiPropertyOptional({
    example: 'LM',
    description: 'Required for business identities; optional for headquarters',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @ValidateIf(
    (input: UserEditableFieldsDto, value: unknown) =>
      !(
        input.identities?.length === 1 &&
        input.identities[0].scope === 'headquarters' &&
        (value === undefined || value === null || value === '')
      ),
  )
  @Matches(/^[A-Z0-9]{1,10}$/)
  tourCode?: string | null;

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

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1, { message: '一个账号只能有一个登录范围和部门' })
  @ValidateNested({ each: true })
  @Type(() => IdentityInput)
  identities: IdentityInput[];

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

export class UpdateUserDto extends UserEditableFieldsDto {}

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

export class UserIdentityResponse {
  @ApiProperty({ enum: COORDINATOR_DUTIES, nullable: true })
  coordinatorDuty: CoordinatorDuty | null;
  @ApiProperty({ type: String, nullable: true }) businessGroupId: string | null;
  @ApiProperty({ type: String, nullable: true }) businessGroupName:
    string | null;
  @ApiProperty({ enum: ['enabled', 'disabled'], nullable: true })
  businessGroupStatus: 'enabled' | 'disabled' | null;
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: LOGIN_SCOPES })
  scope: LoginScope;

  @ApiProperty({ type: Number, nullable: true })
  deptId: number | null;

  @ApiProperty()
  deptName: string;

  @ApiProperty({ type: [String], format: 'uuid' })
  roleIds: string[];

  @ApiProperty()
  roleNames: string;
}

export class UserItemResponse {
  @ApiProperty() feishuOpenId: string;
  @ApiProperty() version: number;
  id: string;
  username: string;
  nickname: string;
  englishName: string;
  tourCode: string | null;
  avatar: string;
  gender: number;
  mobile: string;
  email: string;
  @ApiProperty({ type: () => [UserIdentityResponse] })
  identities: UserIdentityResponse[];
  status: number;
  createTime: string;
}

export class FeishuTestResponse {
  @ApiProperty() messageId: string;
}

export class CreatedUserResponse extends UserItemResponse {
  temporaryPassword?: string;
}
