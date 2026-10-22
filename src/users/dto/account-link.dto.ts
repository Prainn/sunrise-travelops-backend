import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { LoginScope } from '../user-identity.entity';

const code = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;
export class AccountLinkQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  declare keyword?: string;
}
export class AccountLinkCandidateQueryDto extends AccountLinkQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  groupId?: string;
}
export class AccountTourCodeDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() userId: string;
  @ApiProperty()
  @Transform(code)
  @IsString()
  @Matches(/^[A-Z0-9]{1,10}$/)
  tourCode: string;
}
export class CreateAccountLinkDto {
  @ApiProperty({ type: [String], minItems: 2, maxItems: 3 })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  userIds: string[];
  @ApiPropertyOptional({ enum: ['keep', 'unify'], default: 'keep' })
  @IsIn(['keep', 'unify'])
  tourCodeMode: 'keep' | 'unify' = 'keep';
  @ApiPropertyOptional()
  @Transform(code)
  @ValidateIf(
    (o: CreateAccountLinkDto) =>
      o.tourCodeMode === 'unify' || o.tourCode !== undefined,
  )
  @IsString()
  @Matches(/^[A-Z0-9]{1,10}$/)
  tourCode?: string;
  @ApiPropertyOptional({
    type: [AccountTourCodeDto],
    description:
      'Explicit codes for affected members, including removed members',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @ArrayUnique((x: AccountTourCodeDto) => x.userId)
  @ValidateNested({ each: true })
  @Type(() => AccountTourCodeDto)
  tourCodes?: AccountTourCodeDto[];
}
export class UpdateAccountLinkDto extends CreateAccountLinkDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) version: number;
}
export class DeleteAccountLinkDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) version: number;
  @ApiPropertyOptional({ type: [AccountTourCodeDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ArrayUnique((x: AccountTourCodeDto) => x.userId)
  @ValidateNested({ each: true })
  @Type(() => AccountTourCodeDto)
  tourCodes?: AccountTourCodeDto[];
}
export class SwitchAccountDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() targetUserId: string;
}
export class LinkedAccountResponse {
  userId: string;
  identityId: string;
  username: string;
  nickname: string;
  scope: LoginScope;
  scopeName: string;
  status: 'enabled' | 'disabled';
  tourCode: string | null;
  current: boolean;
}
export class AccountLinkResponse {
  id: string;
  version: number;
  members: LinkedAccountResponse[];
}
