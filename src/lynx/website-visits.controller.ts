import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { WebsiteCreateInquiryDto } from '../website/website.dto';
import { WebsiteVisitsQuery } from './website-visits.dto';
import { WebsiteVisitsService } from './website-visits.service';
@ApiTags('Website visits')
@ApiBearerAuth()
@Controller('ledgers/website-visits')
export class WebsiteVisitsController {
  constructor(private readonly service: WebsiteVisitsService) {}
  @Get()
  @Permissions('website:visit:list')
  @Header('Cache-Control', 'no-store')
  list(
    @Query() query: WebsiteVisitsQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.list(query, user);
  }
  @Get('export')
  @Permissions('website:visit:export')
  @Header('Cache-Control', 'no-store')
  export(
    @Query() query: WebsiteVisitsQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.export(query, user);
  }
  @Get(':id/inquiry-draft')
  @Permissions('website:visit:list', 'website:inquiry:create')
  draft(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.draft(id, user);
  }
  @Post(':id/inquiry')
  @Permissions('website:visit:list', 'website:inquiry:create')
  create(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: WebsiteCreateInquiryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(id, body, user);
  }
}
