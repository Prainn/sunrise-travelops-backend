import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Query,
  Req,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { Public } from '../auth/decorators/public.decorator';
import { LynxVisit } from './lynx-visit.entity';

@ApiExcludeController()
@Controller('lynx')
export class LynxController {
  constructor(
    @InjectRepository(LynxVisit)
    private readonly visits: Repository<LynxVisit>,
  ) {}

  @Public()
  @Get()
  @Header('Cache-Control', 'no-store')
  async record(
    @Query('whatsapp_reference') reference: unknown,
    @Req() request: Request,
  ): Promise<{ recorded: true }> {
    if (
      typeof reference !== 'string' ||
      reference.trim().length === 0 ||
      reference.trim().length > 128
    ) {
      throw new BadRequestException(
        'whatsapp_reference must be a non-empty string of at most 128 characters',
      );
    }

    await this.visits.insert({
      whatsappReference: reference.trim(),
      ip: request.ip ?? null,
      browser: request.get('user-agent') ?? '',
    });
    return { recorded: true };
  }
}
