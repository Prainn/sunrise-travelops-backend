import { OmitType } from '@nestjs/swagger';
import { CustomerNotesDto } from '../whatsapp/whatsapp.dto';
import {
  IsArray,
  IsEmail,
  IsUUID,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  Matches,
} from 'class-validator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

export class MailListQuery extends PaginationQueryDto {
  @IsOptional() @IsEmail() @MaxLength(254) mailbox?: string;
  @IsOptional() @IsIn(['all', 'unassigned', 'mine']) view?:
    'all' | 'unassigned' | 'mine';
  @IsOptional() @IsString() @MaxLength(200) declare keyword?: string;
}
export class ReadMailDto {
  @IsArray() @IsUUID('4', { each: true }) messageIds: string[];
}
export class MailVersionDto {
  @IsInt() @Min(1) version: number;
}
export class SaveMailDraftDto extends MailVersionDto {
  @IsArray() @IsEmail({}, { each: true }) to: string[];
  @IsArray() @IsEmail({}, { each: true }) cc: string[];
  @IsString() @MaxLength(998) @Matches(/^[^\r\n]*$/) subject: string;
  @IsString() @MaxLength(100000) body: string;
}

export class MailCustomerNotesDto extends OmitType(CustomerNotesDto, [
  'contactInfo',
] as const) {}
