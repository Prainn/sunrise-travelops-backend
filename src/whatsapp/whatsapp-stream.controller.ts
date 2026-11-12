import { Controller, Get, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiProduces, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import { SkipResponseWrap } from '../common/decorators/skip-response-wrap.decorator';
import { WhatsappStreamService } from './whatsapp-stream.service';

@ApiTags('WhatsApp Workbench')
@ApiBearerAuth()
@Controller('whatsapp')
export class WhatsappStreamController {
  constructor(private readonly streams: WhatsappStreamService) {}
  @Get('stream')
  @Permissions('whatsapp:conversation:list')
  @SkipResponseWrap()
  @ApiProduces('text/event-stream')
  open(@CurrentUser() user: AuthenticatedUser, @Res() response: Response) {
    return this.streams.open(user, response);
  }
}
