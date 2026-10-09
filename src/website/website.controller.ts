import {
  HttpCode,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import {
  WebsiteConfigDto,
  WebsiteConfigQuery,
  WebsiteConfirmDto,
  WebsiteCreateItineraryDto,
  WebsiteGenerateDto,
  WebsiteInquiryDto,
  WebsiteInquiryQuery,
  WebsiteResourceQuery,
  WebsiteTransferDto,
  WebsiteUpdateInquiryDto,
  WebsiteUpdateItineraryDto,
  WebsiteVersionDto,
} from './website.dto';
import { WebsiteService } from './website.service';

@ApiTags('Website')
@ApiBearerAuth()
@Controller('website')
export class WebsiteController {
  constructor(private readonly service: WebsiteService) {}
  @Get('inquiries')
  @Permissions('website:inquiry:list')
  list(
    @Query() query: WebsiteInquiryQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.list(query, user);
  }
  @Post('inquiries')
  @Permissions('website:inquiry:create')
  create(
    @Body() input: WebsiteInquiryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(input, user);
  }
  @Get('owners')
  @Permissions('website:inquiry:list')
  owners(@CurrentUser() user: AuthenticatedUser) {
    return this.service.owners(user);
  }
  @Get('inquiries/:id')
  @Permissions('website:inquiry:list')
  detail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.detail(id, user);
  }
  @Put('inquiries/:id')
  @Permissions('website:inquiry:update')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: WebsiteUpdateInquiryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, input, user);
  }
  @Post('inquiries/:id/transfer')
  @Permissions('website:inquiry:transfer')
  transfer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: WebsiteTransferDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.transfer(id, input, user);
  }
  @Post('inquiries/:id/archive')
  @Permissions('website:inquiry:archive')
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: WebsiteVersionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.archive(id, input.version, user);
  }
  @Get('inquiries/:id/logs')
  @Permissions('website:inquiry:list')
  logs(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.logs(id, query, user);
  }
  @Get('inquiries/:id/itineraries')
  @Permissions('website:itinerary:list')
  itineraries(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.itineraries(id, user);
  }
  @Post('inquiries/:id/itineraries')
  @Permissions('website:itinerary:create')
  createItinerary(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: WebsiteCreateItineraryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.createItinerary(id, input, user);
  }
  @Get('itineraries/:id')
  @Permissions('website:itinerary:list')
  itineraryDetail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.itineraryDetail(id, user);
  }
  @Put('itineraries/:id')
  @Permissions('website:itinerary:update')
  saveItinerary(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: WebsiteUpdateItineraryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.saveItinerary(id, input, user);
  }
  @Post('itineraries/:id/copy')
  @Permissions('website:itinerary:create')
  copy(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: WebsiteVersionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.copyItinerary(id, input.version, user);
  }
  @Post('itineraries/:id/generate')
  @Permissions('website:itinerary:update')
  generate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: WebsiteGenerateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.generate(id, input.version, input.skeletonId, user);
  }
  @Get('itineraries/:id/preview')
  @Permissions('website:itinerary:list')
  preview(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.preview(id, user);
  }
  @Post('itineraries/:id/confirm')
  @Permissions('website:itinerary:confirm')
  confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: WebsiteConfirmDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.confirm(id, input, user);
  }
  @Post('itineraries/:id/download-click')
  @HttpCode(200)
  @Permissions('website:itinerary:download')
  downloadClick(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.recordDownload(id, user);
  }
  @Get('itineraries/:id/quotation')
  @Permissions('website:itinerary:download')
  quotation(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.quotation(id, user);
  }
  @Get('config')
  @Permissions('website:config:list')
  config(
    @Query() query: WebsiteConfigQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.getConfig(user, query.version);
  }
  @Put('config')
  @Permissions('website:config:update')
  saveConfig(
    @Body() input: WebsiteConfigDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.saveConfig(input, user);
  }
  @Get('resources/:kind')
  @Permissions('website:config:list')
  resources(
    @Param('kind') kind: string,
    @Query() query: WebsiteResourceQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.resources(kind, query, user);
  }
}
