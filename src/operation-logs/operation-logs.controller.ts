import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { Permissions } from '../auth/decorators/permissions.decorator';
import {
  OPERATION_CATEGORIES,
  OperationCategory,
  OperationLogsService,
} from './operation-logs.service';

class OperationLogQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(OPERATION_CATEGORIES)
  category?: OperationCategory;
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
    return this.logs.page(query.page, query.pageSize, query.category);
  }
}
