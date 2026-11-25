import { isUserAction } from './operation-routes';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import {
  ClientOperationDto,
  clientEntry,
  PUBLIC_CLIENT_PAGES,
} from './client-operation.dto';
import {
  Body,
  Controller,
  ExecutionContext,
  Get,
  HttpCode,
  Injectable,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { LOGIN_SCOPES } from '../users/user-identity.entity';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { Permissions } from '../auth/decorators/permissions.decorator';
import {
  OPERATION_CATEGORIES,
  OperationCategory,
  OperationScope,
  OperationLogsService,
} from './operation-logs.service';

const AUDIT_SCOPES = [...LOGIN_SCOPES, 'unknown'];
@Injectable()
export class ClientEventIdentityGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();
    if (req.headers.authorization !== undefined)
      return super.canActivate(context);
    return true;
  }
}

export class OperationLogQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: OPERATION_CATEGORIES })
  @IsOptional()
  @IsIn(OPERATION_CATEGORIES)
  category?: OperationCategory;

  @ApiPropertyOptional({
    enum: AUDIT_SCOPES,
    description: '操作发生时的登录业务范围',
  })
  @IsOptional()
  @IsIn(AUDIT_SCOPES)
  scope?: OperationScope;

  @ApiPropertyOptional({
    format: 'date-time',
    description: '首屏返回的分页时间上界',
  })
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/)
  snapshotAt?: string;

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

  @Post('client-events')
  @HttpCode(204)
  @Public()
  @UseGuards(ClientEventIdentityGuard)
  @ApiOperation({ summary: '记录浏览器本地操作，公开页面允许受限匿名上报' })
  async clientEvent(
    @Body() input: ClientOperationDto,
    @Req() request: Request & { user?: AuthenticatedUser },
  ) {
    if (
      !request.user &&
      (!PUBLIC_CLIENT_PAGES.some((page) => page === input.page) ||
        input.recordId ||
        ![
          'navigate',
          'retry',
          'select',
          'language',
          'theme',
          'validate',
          'cancel',
          'open',
          'close',
        ].includes(input.action))
    )
      throw new UnauthorizedException();
    if (!isUserAction(request)) return;
    await this.logs.append([
      clientEntry(input, request.user, request.ip ?? ''),
    ]);
  }
}
