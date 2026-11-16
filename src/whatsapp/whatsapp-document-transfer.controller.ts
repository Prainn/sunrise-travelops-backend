import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { WhatsappDocuments } from '../media/media.whatsapp-documents';

@Controller('whatsapp/document-transfer')
export class WhatsappDocumentTransferController {
  constructor(private readonly documents: WhatsappDocuments) {}

  @Public()
  @Get(':messageId/:token/:file')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Referrer-Policy', 'no-referrer')
  get(
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Param('token') token: string,
    @Param('file') file: string,
    @Req() request: Request,
  ) {
    return this.documents.readTransfer(
      messageId,
      token,
      file,
      request.method === 'HEAD',
    );
  }
}
