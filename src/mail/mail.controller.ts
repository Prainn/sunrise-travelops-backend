import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { MAX_DOCUMENT_BYTES } from '../media/media.document-format';
import { AssignChatDto, CreateChatInquiryDto } from '../whatsapp/whatsapp.dto';
import {
  MailCustomerNotesDto,
  MailListQuery,
  MailVersionDto,
  SaveMailDraftDto,
  ReadMailDto,
} from './mail.dto';
import { MailService } from './mail.service';
import { MailReplies } from './mail.replies';

@ApiTags('独立站邮件收件箱')
@ApiBearerAuth()
@Controller('mail')
export class MailController {
  constructor(
    private readonly mail: MailService,
    private readonly replies: MailReplies,
  ) {}
  @Get('summary')
  @Permissions('mail:thread:list')
  summary(@CurrentUser() user: AuthenticatedUser) {
    return this.mail.unread(user);
  }
  @Get('mailboxes')
  @Permissions('mail:thread:list')
  mailboxes(@CurrentUser() user: AuthenticatedUser) {
    return this.mail.mailboxes(user);
  }
  @Get('threads')
  @Permissions('mail:thread:list')
  list(@Query() query: MailListQuery, @CurrentUser() user: AuthenticatedUser) {
    return this.mail.list(query, user);
  }
  @Get('threads/:id')
  @Permissions('mail:thread:list')
  detail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.mail.detail(id, user);
  }
  @Post('threads/:id/read')
  @Permissions('mail:thread:list')
  read(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: ReadMailDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.mail.markRead(id, input.messageIds, user);
  }
  @Get('owners')
  @Permissions('mail:thread:assign')
  owners(@CurrentUser() user: AuthenticatedUser) {
    return this.mail.owners(user);
  }
  @Post('threads/:id/assign')
  @Permissions('mail:thread:assign')
  assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: AssignChatDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.mail.assign(id, input, user);
  }
  @Get('threads/:id/messages/:source/customer-notes')
  @Permissions('mail:thread:list')
  customerNotes(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('source', ParseUUIDPipe) source: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.mail.customerNotes(id, source, user);
  }
  @Put('threads/:id/messages/:source/customer-notes')
  @Permissions('mail:thread:update')
  saveCustomerNotes(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('source', ParseUUIDPipe) source: string,
    @Body() input: MailCustomerNotesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.mail.saveCustomerNotes(id, source, input, user);
  }
  @Post('threads/:id/messages/:source/inquiry')
  @Permissions('mail:inquiry:create', 'website:inquiry:create')
  inquiry(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('source', ParseUUIDPipe) source: string,
    @Body() input: CreateChatInquiryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.mail.createInquiry(id, source, input, user);
  }
  @Post('threads/:id/messages/:source/reply')
  @Permissions('mail:message:send')
  open(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('source', ParseUUIDPipe) source: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.replies.open(id, source, user);
  }
  @Put('threads/:id/drafts/:draft')
  @Permissions('mail:message:send')
  save(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('draft', ParseUUIDPipe) draft: string,
    @Body() input: SaveMailDraftDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.replies.save(id, draft, input, user);
  }
  @Post('threads/:id/drafts/:draft/attachments')
  @Permissions('mail:message:send')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1, fields: 0 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  attach(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('draft', ParseUUIDPipe) draft: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.replies.attach(id, draft, file, user);
  }
  @Delete('threads/:id/drafts/:draft/attachments/:file')
  @Permissions('mail:message:send')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('draft', ParseUUIDPipe) draft: string,
    @Param('file', ParseUUIDPipe) file: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.replies.remove(id, draft, file, user);
  }
  @Post('threads/:id/drafts/:draft/send')
  @Permissions('mail:message:send')
  send(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('draft', ParseUUIDPipe) draft: string,
    @Body() input: MailVersionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.replies.send(id, draft, input, user);
  }
  @Get('threads/:id/attachments/:file/download')
  @Permissions('mail:thread:list')
  @Header('Cache-Control', 'private, no-store')
  download(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('file', ParseUUIDPipe) file: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.mail.download(id, file, user);
  }
}
