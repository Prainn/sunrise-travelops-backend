import {
  Body,
  Controller,
  Get,
  Injectable,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { DataSource } from 'typeorm';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { chatFail, chatManager, chatPermission } from './whatsapp.policy';

export class QuickReplyQuery extends PaginationQueryDto {
  @IsOptional() @IsString() @MaxLength(100) stage?: string;
  @IsOptional() @IsString() @MaxLength(100) scenario?: string;
  @IsOptional() @IsIn(['enabled', 'disabled']) status?: string;
}
export class QuickReplyInput {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  stage: string;
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  scenario: string;
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  content: string;
  @IsBoolean() enabled: boolean;
  @IsInt() @Min(0) @Max(10000) sortOrder: number;
}
export class UpdateQuickReplyInput extends QuickReplyInput {
  @IsInt() @Min(1) version: number;
}
interface QuickReplyRecord {
  id: string;
  stage: string;
  scenario: string;
  content: string;
  enabled: boolean;
  sortOrder: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}
const COLUMNS =
  'id,stage,scenario,content,enabled,sort_order AS "sortOrder",version,created_at AS "createdAt",updated_at AS "updatedAt"';
@Injectable()
export class WhatsappQuickReplies {
  constructor(private readonly db: DataSource) {}
  async list(q: QuickReplyQuery, user: AuthenticatedUser) {
    chatPermission(user);
    const params: unknown[] = [],
      clauses: string[] = [];
    if (!chatManager(user)) clauses.push('enabled=true');
    if (q.status)
      clauses.push(`enabled=${q.status === 'enabled' ? 'true' : 'false'}`);
    if (q.stage) clauses.push(`stage=$${params.push(q.stage)}`);
    if (q.scenario) clauses.push(`scenario=$${params.push(q.scenario)}`);
    if (q.keyword)
      clauses.push(
        `(stage ILIKE $${params.push(`%${q.keyword.replace(/[\\%_]/g, '\\$&')}%`)} OR scenario ILIKE $${params.length} OR content ILIKE $${params.length})`,
      );
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const [count] = await this.db.query<{ total: string }[]>(
      `SELECT count(*)::text total FROM whatsapp_quick_replies ${where}`,
      params,
    );
    const list = await this.db.query<QuickReplyRecord[]>(
      `SELECT ${COLUMNS} FROM whatsapp_quick_replies ${where} ORDER BY sort_order,stage,scenario,id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, q.pageSize, (q.page - 1) * q.pageSize],
    );
    return {
      list,
      total: Number(count.total),
      page: q.page,
      pageSize: q.pageSize,
    };
  }
  async options(q: QuickReplyQuery, user: AuthenticatedUser) {
    chatPermission(user);
    const stages = await this.db.query<{ value: string }[]>(
      'SELECT stage AS value FROM whatsapp_quick_replies WHERE enabled GROUP BY stage ORDER BY min(sort_order),stage',
    );
    const scenarios = q.stage
      ? await this.db.query<{ value: string }[]>(
          'SELECT scenario AS value FROM whatsapp_quick_replies WHERE enabled AND stage=$1 ORDER BY sort_order,scenario',
          [q.stage],
        )
      : [];
    return {
      stages: stages.map((x) => x.value),
      scenarios: scenarios.map((x) => x.value),
    };
  }
  async detail(id: string, user: AuthenticatedUser) {
    chatPermission(user, 'whatsapp:quick-reply:manage');
    if (!chatManager(user))
      chatFail('AUTH_FORBIDDEN', '只有主管可维护快捷回复', 403);
    const [row] = await this.db.query<QuickReplyRecord[]>(
      `SELECT ${COLUMNS} FROM whatsapp_quick_replies WHERE id=$1`,
      [id],
    );
    if (!row) chatFail('NOT_FOUND', '快捷回复不存在', 404);
    return row;
  }
  async save(
    input: QuickReplyInput | UpdateQuickReplyInput,
    user: AuthenticatedUser,
    id?: string,
  ) {
    chatPermission(user, 'whatsapp:quick-reply:manage');
    if (!chatManager(user))
      chatFail('AUTH_FORBIDDEN', '只有主管可维护快捷回复', 403);
    if (!id) {
      const [row] = await this.db.query<QuickReplyRecord[]>(
        `INSERT INTO whatsapp_quick_replies(stage,scenario,content,enabled,sort_order,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$6) RETURNING ${COLUMNS}`,
        [
          input.stage,
          input.scenario,
          input.content,
          input.enabled,
          input.sortOrder,
          user.id,
        ],
      );
      return row;
    }
    return this.db.transaction(async (m) => {
      const [old] = await m.query<{ version: number }[]>(
        'SELECT version FROM whatsapp_quick_replies WHERE id=$1 FOR UPDATE',
        [id],
      );
      if (!old) chatFail('NOT_FOUND', '快捷回复不存在', 404);
      if (old.version !== (input as UpdateQuickReplyInput).version)
        chatFail('CONFLICT', '快捷回复已更新，请刷新后重试', 409);
      const [row] = await m.query<QuickReplyRecord[]>(
        `UPDATE whatsapp_quick_replies SET stage=$2,scenario=$3,content=$4,enabled=$5,sort_order=$6,version=version+1,updated_by=$7,updated_at=now() WHERE id=$1 RETURNING ${COLUMNS}`,
        [
          id,
          input.stage,
          input.scenario,
          input.content,
          input.enabled,
          input.sortOrder,
          user.id,
        ],
      );
      return row;
    });
  }
}
@ApiTags('WhatsApp')
@ApiBearerAuth()
@Controller('whatsapp/quick-replies')
export class WhatsappQuickRepliesController {
  constructor(private readonly service: WhatsappQuickReplies) {}
  @Get('manage')
  @Permissions('whatsapp:quick-reply:manage')
  manage(@Query() q: QuickReplyQuery, @CurrentUser() u: AuthenticatedUser) {
    return this.service.list(q, u);
  }
  @Get('options')
  @Permissions('whatsapp:conversation:list')
  options(@Query() q: QuickReplyQuery, @CurrentUser() u: AuthenticatedUser) {
    return this.service.options(q, u);
  }
  @Get()
  @Permissions('whatsapp:conversation:list')
  list(@Query() q: QuickReplyQuery, @CurrentUser() u: AuthenticatedUser) {
    return this.service.list(q, u);
  }
  @Get(':id')
  @Permissions('whatsapp:quick-reply:manage')
  detail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.detail(id, user);
  }
  @Post()
  @Permissions('whatsapp:quick-reply:manage')
  create(@Body() input: QuickReplyInput, @CurrentUser() u: AuthenticatedUser) {
    return this.service.save(input, u);
  }
  @Put(':id')
  @Permissions('whatsapp:quick-reply:manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateQuickReplyInput,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.service.save(input, u, id);
  }
}
