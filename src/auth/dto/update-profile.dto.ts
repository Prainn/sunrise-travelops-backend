import {
  IsOptional,
  IsString,
  IsIn,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
export class UpdateProfileDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  nickname?: string;
  @IsOptional() @IsString() @MaxLength(2000000) avatar?: string;
  @IsOptional() @IsIn([0, 1, 2]) gender?: number;
}
