import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class WhatsappRegisterDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  whatsapp_reference!: string;
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  website_inquiry_id!: string;
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  contract_version!: string;
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  first_landing_page?: string | null;
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  external_referrer?: string | null;
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  utm_source?: string | null;
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  utm_medium?: string | null;
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  utm_campaign?: string | null;
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  utm_term?: string | null;
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  utm_content?: string | null;
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  gclid?: string | null;
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  gbraid?: string | null;
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  wbraid?: string | null;
}
