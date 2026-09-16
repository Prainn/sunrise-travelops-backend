import { timingSafeEqual } from 'node:crypto';
import {
  Controller,
  ForbiddenException,
  Get,
  Header,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
  Body,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { WhatsappRegisterDto } from './whatsapp-register.dto';
import { WhatsappRegistryService } from './whatsapp-registry.service';

@ApiExcludeController()
@Controller('v1')
export class LynxController {
  constructor(
    private readonly registry: WhatsappRegistryService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('whatsapp/register')
  @Header('Cache-Control', 'no-store')
  async register(
    @Body() body: WhatsappRegisterDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ recorded: true }> {
    const inserted = await this.registry.register(body);
    if (!inserted) response.status(200);
    return { recorded: true };
  }

  @Public()
  @Get('private/whatsapp/:whatsapp_reference')
  @Header('Cache-Control', 'no-store')
  async resolve(
    @Param('whatsapp_reference') reference: string,
    @Req() request: Request,
  ): Promise<Record<string, string | null>> {
    const authorization = request.headers.authorization;
    if (!authorization) throw new UnauthorizedException();
    if (!authorization.startsWith('Bearer ')) throw new ForbiddenException();
    const supplied = Buffer.from(authorization.slice(7));
    const expected = Buffer.from(
      this.config.getOrThrow<string>('WHATSAPP_RESOLVER_TOKEN'),
    );
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      throw new UnauthorizedException();
    }
    return this.registry.resolve(reference);
  }
}
