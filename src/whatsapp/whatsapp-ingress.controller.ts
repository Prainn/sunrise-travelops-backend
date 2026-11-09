import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { SkipResponseWrap } from '../common/decorators/skip-response-wrap.decorator';
import { WhatsappEvents } from './whatsapp.events';
import { WhatsappConfig } from './whatsapp.config';
import { WhatsappService } from './whatsapp.service';
import { MessageSourceDto } from './whatsapp.dto';
import { chatFail } from './whatsapp.policy';
// HTTP is a backup behind an authenticated gateway that injects Authorization.
// This is not an assertion that Alibaba sends this header itself.
@Controller('whatsapp/ingress')
export class WhatsappIngressController {
  constructor(
    private readonly events: WhatsappEvents,
    private readonly config: WhatsappConfig,
    private readonly service: WhatsappService,
  ) {}
  @Post('inbound')
  @HttpCode(200)
  @Public()
  @SkipResponseWrap()
  async inbound(
    @Headers('authorization') auth: string | undefined,
    @Body() body: unknown,
  ) {
    return this.receive(auth, body, 'inbound');
  }
  @Post('status')
  @HttpCode(200)
  @Public()
  @SkipResponseWrap()
  async status(
    @Headers('authorization') auth: string | undefined,
    @Body() body: unknown,
  ) {
    return this.receive(auth, body, 'status');
  }
  private async receive(
    auth: string | undefined,
    body: unknown,
    kind: 'inbound' | 'status',
  ) {
    this.config.authorize(auth, 'HTTP_TOKEN');
    if (this.config.mode !== 'http')
      chatFail('AUTH_FORBIDDEN', 'HTTP消息接收未启用', 403);
    await this.events.receive(body, kind);
    return { code: 0, msg: '成功' };
  }
  @Post('accounts/:accountId/messages/:providerId/source')
  @HttpCode(200)
  @Public()
  source(
    @Headers('authorization') auth: string | undefined,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Param('providerId') providerId: string,
    @Body() body: MessageSourceDto,
  ) {
    this.config.authorize(auth, 'SOURCE_TOKEN');
    if (!providerId || providerId.length > 1000)
      chatFail('VALIDATION_ERROR', '无效消息编号', 400);
    return this.service.source(accountId, providerId, body);
  }
}
