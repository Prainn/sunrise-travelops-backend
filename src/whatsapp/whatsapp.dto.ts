import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { OmitType } from '@nestjs/swagger';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { WebsiteInquiryDto } from '../website/website.dto';
export class ChatListQuery extends PaginationQueryDto {
  @IsOptional() @IsIn(['mine', 'unassigned', 'all']) view?: string;
  @IsOptional() @IsIn(['open', 'closed', 'archived']) state?: string;
  @IsOptional() @IsUUID() ownerId?: string;
  @IsOptional() @IsUUID() accountId?: string;
  @IsOptional() @IsIn(['true', 'false']) unread?: string;
}
export class MessageListQuery extends PaginationQueryDto {
  @IsOptional() @Matches(/^\d{1,19}$/) beforeSeq?: string;
  @IsOptional() @Matches(/^\d{1,19}$/) afterSeq?: string;
}
export class ChatVersionDto {
  @IsInt() @Min(1) version: number;
}
export class AssignChatDto extends ChatVersionDto {
  @IsUUID() ownerId: string;
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  reason: string;
}
export class ChatStateDto extends ChatVersionDto {
  @IsIn(['open', 'closed']) state: 'open' | 'closed';
}
export class CustomerNotesDto extends ChatVersionDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(100)
  customerName = '';
  @IsDefined()
  @ValidateIf((o: CustomerNotesDto) => o.countryItemId !== null)
  @IsUUID()
  countryItemId: string | null = null;
  @IsDefined()
  @ValidateIf((o: CustomerNotesDto) => o.plannedDays !== null)
  @IsInt()
  @Min(1)
  @Max(365)
  plannedDays: number | null = null;
  @IsDefined()
  @ValidateIf((o: CustomerNotesDto) => o.startDate !== null)
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate: string | null = null;
  @IsDefined()
  @ValidateIf((o: CustomerNotesDto) => o.pax !== null)
  @IsInt()
  @Min(1)
  @Max(10000)
  pax: number | null = null;
  @IsString() @MaxLength(500) contactInfo = '';
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(365)
  @IsUUID(undefined, { each: true })
  destinations: string[] = [];
  @IsString() @MaxLength(200000) requirements = '';
  @IsString() @MaxLength(20000) internalRemark = '';
}
export class ReadChatDto {
  @Matches(/^\d{1,19}$/) lastSeq: string;
}
export class SendTextDto {
  @IsUUID() clientRequestId: string;
  @IsOptional() @IsUUID() replyToMessageId?: string;
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  text: string;
}
export class SendReactionDto {
  @IsUUID() clientRequestId: string;
  @IsIn(['👍', '❤️', '😂', '😮', '😢', '🙏', '']) emoji: string;
}
export class RetryMessageDto {
  @IsUUID() clientRequestId: string;
}
export class CreateChatInquiryDto extends OmitType(WebsiteInquiryDto, [
  'ownerId',
  'status',
  'lostReason',
] as const) {
  @IsInt() @Min(1) version: number;
}
export class MessageSourceDto {
  @IsString() @MinLength(1) @MaxLength(200) sourceReference: string;
  @IsString() @MaxLength(200) websiteInquiryNo = '';
  @IsString() @MaxLength(2048) landingPage = '';
  @IsString() @MaxLength(2048) acquisitionSource = '';
}
