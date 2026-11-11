import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { WhatsappService } from './whatsapp.service';
import {
  AssignChatDto,
  ChatListQuery,
  ChatStateDto,
  ChatVersionDto,
  CreateChatInquiryDto,
  CustomerNotesDto,
  MessageListQuery,
  ReadChatDto,
  RetryMessageDto,
  SendTextDto,
  SendReactionDto,
} from './whatsapp.dto';
@ApiTags('WhatsApp Workbench')
@ApiBearerAuth()
@Controller('whatsapp')
export class WhatsappController {
  constructor(private readonly service: WhatsappService) {}
  @Get('conversations')
  @Permissions('whatsapp:conversation:list')
  list(@Query() query: ChatListQuery, @CurrentUser() user: AuthenticatedUser) {
    return this.service.list(query, user);
  }
  @Get('summary')
  @Permissions('whatsapp:conversation:list')
  summary(@CurrentUser() user: AuthenticatedUser) {
    return this.service.summary(user);
  }
  @Get('owners')
  @Permissions('whatsapp:conversation:assign')
  owners(@CurrentUser() user: AuthenticatedUser) {
    return this.service.owners(user);
  }
  @Get('conversations/:id')
  @Permissions('whatsapp:conversation:list')
  detail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.detail(id, user);
  }
  @Get('conversations/:id/messages')
  @Permissions('whatsapp:conversation:list')
  messages(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: MessageListQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.messages(id, query, user);
  }
  @Get('conversations/:id/customer-notes')
  @Permissions('whatsapp:conversation:list')
  customerNotes(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.customerNotes(id, user);
  }
  @Put('conversations/:id/customer-notes')
  @Permissions('whatsapp:conversation:update')
  saveCustomerNotes(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: CustomerNotesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.saveCustomerNotes(id, input, user);
  }
  @Get('conversations/:id/actions')
  @Permissions('whatsapp:conversation:list')
  actions(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.actions(id, query, user);
  }
  @Post('conversations/:id/assign')
  @HttpCode(200)
  @Permissions('whatsapp:conversation:assign')
  assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: AssignChatDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.assign(id, input, user);
  }
  @Post('conversations/:id/state')
  @HttpCode(200)
  @Permissions('whatsapp:conversation:update')
  state(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: ChatStateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.setState(id, input, user);
  }
  @Post('conversations/:id/new-consultation')
  @Permissions('whatsapp:conversation:update')
  newConsultation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: ChatVersionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.startConsultation(id, input.version, user);
  }
  @Post('conversations/:id/read')
  @HttpCode(200)
  @Permissions('whatsapp:conversation:list')
  read(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: ReadChatDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.markRead(id, input.lastSeq, user);
  }
  @Get('conversations/:id/inquiry-prefill')
  @Permissions('whatsapp:inquiry:create', 'website:inquiry:create')
  prefill(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.prefill(id, user);
  }
  @Post('conversations/:id/inquiry')
  @Permissions('whatsapp:inquiry:create', 'website:inquiry:create')
  inquiry(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: CreateChatInquiryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.createInquiry(id, input, user);
  }
  @Post('conversations/:id/messages')
  @Permissions('whatsapp:message:send')
  send(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: SendTextDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.enqueue(id, input, user);
  }
  @Post('conversations/:id/messages/:messageId/reactions')
  @Permissions('whatsapp:message:send')
  react(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() input: SendReactionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.enqueue(
      id,
      { clientRequestId: input.clientRequestId, text: input.emoji },
      user,
      undefined,
      { targetMessageId: messageId, emoji: input.emoji },
    );
  }
  @Post('conversations/:id/messages/:messageId/retry')
  @Permissions('whatsapp:message:send')
  retry(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() input: RetryMessageDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.retryMessage(
      id,
      messageId,
      input.clientRequestId,
      user,
    );
  }
  @Post('conversations/:id/messages/:messageId/confirm-failed')
  @HttpCode(200)
  @Permissions('whatsapp:message:send')
  confirmFailed(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.confirmFailed(id, messageId, user);
  }
  @Get('integration')
  @Permissions('whatsapp:integration:manage')
  integration(@CurrentUser() user: AuthenticatedUser) {
    return this.service.integration(user);
  }
  @Get('integration/failed-events')
  @Permissions('whatsapp:integration:manage')
  failedEvents(
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.failedEvents(query, user);
  }
  @Post('integration/events/:id/retry')
  @HttpCode(200)
  @Permissions('whatsapp:integration:manage')
  retryEvent(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.retryEvent(id, user);
  }
}
