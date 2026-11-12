import {
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  IsIn,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
export class MediaQuery extends PaginationQueryDto {
  @IsOptional() @IsString() @MaxLength(200) keyword?: string = undefined;
  @IsOptional() @IsIn(['image', 'sticker']) kind?: string;
  @IsOptional()
  @IsIn(['pending', 'processing', 'ready', 'failed', 'deleting'])
  state?: string;
}
export class UpdateMediaDto {
  @IsInt() @Min(1) version: number;
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(200)
  name: string;
  @IsString() @MaxLength(1000) remark = '';
}
export class MediaVersionDto {
  @Type(() => Number) @IsInt() @Min(1) version: number;
}
