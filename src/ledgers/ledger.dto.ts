import { Type, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
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
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LedgerQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;
  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  keyword?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  from?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  to?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() creatorId?: string;
}
export class DirectLedgerQueryDto extends LedgerQueryDto {
  @ApiPropertyOptional({ enum: ['linxi', 'website'] })
  @IsOptional()
  @IsIn(['linxi', 'website'])
  businessUnit?: 'linxi' | 'website';
  @ApiPropertyOptional({ enum: ['unconverted', 'converted'] })
  @IsOptional()
  @IsIn(['unconverted', 'converted'])
  orderStatus?: 'unconverted' | 'converted';
}
export class AgencyOptionsQueryDto extends LedgerQueryDto {
  @ApiPropertyOptional({
    description: '编辑已有记录时传入，以原创建人限制组团社选项',
  })
  @IsOptional()
  @IsUUID()
  ledgerId?: string;
}
export class LedgerVersionDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) version!: number;
}
export class LedgerDeleteQueryDto {
  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}
export class LedgerOperationDto extends LedgerVersionDto {
  @ApiProperty() @IsBoolean() operated!: boolean;
}
export class ShengxuLedgerInputDto {
  @ApiProperty()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  recordDate!: string;
  @ApiProperty() @IsUUID() agencyId!: string;
  @ApiProperty() @IsUUID() contactId!: string;
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(2147483647)
  quotedGroups!: number;
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(2147483647)
  convertedGroups!: number;
  @ApiPropertyOptional({ default: false }) @IsBoolean() quoteSent = false;
  @ApiPropertyOptional({ default: '' }) @IsString() @MaxLength(5000) itinerary =
    '';
  @ApiPropertyOptional({ default: '' })
  @IsString()
  @MaxLength(2000)
  notConvertedReason = '';
}
export class UpdateShengxuLedgerDto extends ShengxuLedgerInputDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) version!: number;
}
export class DirectLedgerInputDto {
  @ApiProperty()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  receivedDate!: string;
  @ApiProperty()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Matches(/\S/)
  @MaxLength(200)
  source!: string;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  receivingAccountId?: string | null;
  @ApiProperty() @IsUUID() operatorId!: string;
  @ApiPropertyOptional({
    enum: ['unconverted', 'converted'],
    default: 'unconverted',
  })
  @IsIn(['unconverted', 'converted'])
  orderStatus: 'unconverted' | 'converted' = 'unconverted';
  @ApiPropertyOptional({ default: false }) @IsBoolean() effectiveContact =
    false;
  @ApiPropertyOptional({ default: false }) @IsBoolean() proposalSent = false;
  @ApiPropertyOptional({ default: false }) @IsBoolean() loss = false;
  @ApiPropertyOptional({ default: false }) @IsBoolean() priority = false;
  @ApiPropertyOptional({ default: '' }) @IsString() @MaxLength(5000) itinerary =
    '';
  @ApiPropertyOptional({ default: '' })
  @IsString()
  @MaxLength(2000)
  notConvertedReason = '';
  @ApiPropertyOptional({ default: '' }) @IsString() @MaxLength(2000) lossNote =
    '';
  @ApiPropertyOptional({ default: '' }) @IsString() @MaxLength(2000) remark =
    '';
  @ApiPropertyOptional({ default: '' })
  @IsString()
  @MaxLength(2000)
  feedbackReason = '';
  @ApiPropertyOptional({ default: '' }) @IsString() @MaxLength(2000) solution =
    '';
  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_o, value: unknown) => value !== null)
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  dealDate: string | null = null;
  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_o, value: unknown) => value !== null)
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  departureDate: string | null = null;
  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_o, value: unknown) => value !== null)
  @IsBoolean()
  complaint: boolean | null = null;
  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_o, value: unknown) => value !== null)
  @IsBoolean()
  satisfied: boolean | null = null;
}
export class UpdateDirectLedgerDto extends DirectLedgerInputDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) version!: number;
}
