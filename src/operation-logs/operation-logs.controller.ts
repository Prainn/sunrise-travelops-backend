import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
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
    );
  }
}
