import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
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
export class ReadChatDto {
  @Matches(/^\d{1,19}$/) lastSeq: string;
}
export class SendTextDto {
  @IsUUID() clientRequestId: string;
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  text: string;
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
