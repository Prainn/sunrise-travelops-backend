import { timingSafeEqual } from 'node:crypto';
import {
  Controller,
  ForbiddenException,
  Get,
  Header,
  Param,
  Query,
  Post,
  Req,
  Res,
  UnauthorizedException,
  Body,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { WhatsappListQueryDto } from './whatsapp-list.dto';
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
    this.requireLocalSource();
    const inserted = await this.registry.register(body);
    if (!inserted) response.status(200);
    return { recorded: true };
  }

  @Public()
  @Get('private/whatsapp')
  @Header('Cache-Control', 'no-store')
  list(@Query() query: WhatsappListQueryDto, @Req() request: Request) {
    this.requireLocalSource();
    this.authorizeResolver(request);
    return this.registry.list(query);
  }

  @Public()
  @Get('private/whatsapp/:whatsapp_reference')
  @Header('Cache-Control', 'no-store')
  async resolve(
    @Param('whatsapp_reference') reference: string,
    @Req() request: Request,
  ): Promise<Record<string, string>> {
    this.requireLocalSource();
    this.authorizeResolver(request);
    return this.registry.resolve(reference);
  }

  private requireLocalSource(): void {
    if (this.config.get<string>('LYNX_VISITS_SOURCE_MODE') === 'http') {
      throw new ServiceUnavailableException(
        'Visit registration and legacy resolution require the canonical source host',
      );
    }
  }

  private authorizeResolver(request: Request): void {
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
  }
}
