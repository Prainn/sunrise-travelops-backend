import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { WebsiteVisitsApiGuard } from './website-visits-api.guard';
import { WebsiteVisitsDatabaseSource } from './website-visits-database.source';
import { WebsiteVisitsQuery } from './website-visits.dto';

/** Machine GET API. Public bypasses business JWT only; the dedicated guard is mandatory. */
@Public()
@ApiExcludeController()
@UseGuards(WebsiteVisitsApiGuard)
@Controller('internal/website-visits')
export class WebsiteVisitsApiController {
  constructor(private readonly source: WebsiteVisitsDatabaseSource) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Query() query: WebsiteVisitsQuery) {
    return this.source.list(query);
  }

  @Get('export')
  @Header('Cache-Control', 'no-store')
  export(@Query() query: WebsiteVisitsQuery) {
    return this.source.export(query);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  row(@Param('id', ParseUUIDPipe) id: string) {
    return this.source.row(id);
  }
}
