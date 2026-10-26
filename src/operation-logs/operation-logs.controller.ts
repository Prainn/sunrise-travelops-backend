import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { LOGIN_SCOPES, LoginScope } from '../users/user-identity.entity';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { Permissions } from '../auth/decorators/permissions.decorator';
import {
  OPERATION_CATEGORIES,
  OperationCategory,
  OperationLogsService,
} from './operation-logs.service';

export class OperationLogQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: OPERATION_CATEGORIES })
  @IsOptional()
  @IsIn(OPERATION_CATEGORIES)
  category?: OperationCategory;

  @ApiPropertyOptional({
    enum: LOGIN_SCOPES,
    description: '操作发生时的登录业务范围',
  })
  @IsOptional()
  @IsIn(LOGIN_SCOPES)
  scope?: LoginScope;

  @ApiPropertyOptional({
    description: '开始日期（北京时间，含当日）',
    example: '2026-10-26',
  })
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^[1-9]\d{3}-\d{2}-\d{2}$/)
  start?: string;

  @ApiPropertyOptional({
    description: '结束日期（北京时间，含当日）',
    example: '2026-10-26',
  })
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^[1-9]\d{3}-\d{2}-\d{2}$/)
  end?: string;

  @ApiPropertyOptional({
    description: '按日志操作人名称包含搜索，不区分大小写',
    maxLength: 80,
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  actorName?: string;
}

@ApiTags('System')
@ApiBearerAuth()
@Controller('system/operation-logs')
export class OperationLogsController {
  constructor(private readonly logs: OperationLogsService) {}

  @Get()
  @Permissions('sys:operation-log:list')
  @ApiOperation({ summary: 'List operation logs' })
  list(@Query() query: OperationLogQueryDto) {
    return this.logs.page(
      query.page,
      query.pageSize,
      query.category,
      query.scope,
      query,
    );
  }
}
