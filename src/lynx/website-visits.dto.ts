import {
  IsDateString,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
export class WebsiteVisitsQuery extends PaginationQueryDto {
  pageSize = 50;
  @IsOptional() @IsString() @MaxLength(200) keyword: string | undefined =
    undefined;
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^[1-9]\d{3}-\d{2}-\d{2}$/)
  start?: string;
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^[1-9]\d{3}-\d{2}-\d{2}$/)
  end?: string;
}
