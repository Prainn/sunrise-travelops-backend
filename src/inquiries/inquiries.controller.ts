import { BusinessUnit } from '../users/user-identity.entity';
import { TransferInquiryDto } from './inquiry.dto';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  parseInquiryDocument,
  type InquiryDocumentFile,
} from './parse-inquiry-document';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { InquiriesService } from './inquiries.service';
import {
  ConfirmPdfDto,
  ContactInput,
  CopyItineraryDto,
  InquiryInput,
  InquiryQuery,
  ItineraryInput,
  LogQuery,
  UpdateInquiryDto,
  UpdateItineraryDto,
  VersionDto,
} from './inquiry.dto';
import { moneyResponse } from './changes';

@ApiTags('Inquiries')
@ApiBearerAuth()
@Controller('inquiries')
export class InquiriesController {
  constructor(private readonly service: InquiriesService) {}
  @Get('')
  @Permissions('inquiry:list')
  async list(
    @Query() query: InquiryQuery,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const actor = await this.service.actor(user, req);
    const result = await this.service.list(query, actor);
    return { ...result, list: moneyResponse(result.list) };
  }
  @Get('owners')
  @Permissions('inquiry:list')
  async owners(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Query('businessUnit') businessUnit?: BusinessUnit,
  ) {
    const actor = await this.service.actor(user, req);
    return moneyResponse(await this.service.owners(actor, businessUnit));
  }
  @Post('')
  @Permissions('inquiry:create')
  async create(
    @Body() input: InquiryInput,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const actor = await this.service.actor(user, req);
    return moneyResponse(await this.service.create(input, actor));
  }
  @Post('parse-document')
  @Permissions('inquiry:create')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 0 },
    }),
  )
  parseDocument(@UploadedFile() file?: InquiryDocumentFile) {
    return parseInquiryDocument(file);
  }
  @Post('contacts/:id')
  @Permissions('inquiry:create')
  async contact(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: ContactInput,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const actor = await this.service.actor(user, req);
    return moneyResponse(await this.service.createContact(id, input, actor));
  }
  @Post(':id/transfer')
  @Permissions('inquiry:transfer')
  async transfer(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: TransferInquiryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return moneyResponse(
      await this.service.transfer(
        id,
        input,
        await this.service.actor(user, req),
      ),
    );
  }
  @Get(':id/transfers')
  @Permissions('inquiry:list')
  async transfers(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.service.transfers(id, await this.service.actor(user, req));
  }
  @Get(':id')
  @Permissions('inquiry:list')
  async detail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const actor = await this.service.actor(user, req);
    return moneyResponse(await this.service.detail(id, actor));
  }
  @Put(':id')
  @Permissions('inquiry:update')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateInquiryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const actor = await this.service.actor(user, req);
    return moneyResponse(await this.service.update(id, input, actor));
  }
  @Post(':id/archive')
  @Permissions('inquiry:archive')
  async archive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: VersionDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const actor = await this.service.actor(user, req);
    return moneyResponse(await this.service.archive(id, input.version, actor));
  }
  @Get(':id/itineraries')
  @Permissions('itinerary:list')
  async plans(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const actor = await this.service.actor(user, req);
    return moneyResponse(await this.service.itineraries(id, actor));
  }
  @Post(':id/itineraries')
  @Permissions('itinerary:create')
  async createPlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: ItineraryInput,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const actor = await this.service.actor(user, req);
    return moneyResponse(await this.service.createItinerary(id, input, actor));
  }
}

@ApiTags('Inquiries')
@ApiBearerAuth()
@Controller('itineraries')
export class ItinerariesController {
  constructor(private readonly service: InquiriesService) {}
  @Get(':id/price-adjustments')
  @Permissions('itinerary:list')
  async priceAdjustments(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.service.priceAdjustments(
      id,
      await this.service.actor(user, req),
    );
  }
  @Get(':id')
  @Permissions('itinerary:list')
  async detail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const actor = await this.service.actor(user, req);
    return moneyResponse(await this.service.itinerary(id, actor));
  }
  @Put(':id')
  @Permissions('itinerary:update')
  async save(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateItineraryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const actor = await this.service.actor(user, req);
    return moneyResponse(await this.service.saveItinerary(id, input, actor));
  }
  @Get(':id/quote-calculation')
  @Permissions('itinerary:list')
  async quoteCalculation(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const actor = await this.service.actor(user, req);
    return moneyResponse(await this.service.quoteCalculation(id, actor));
  }
  @Post(':id/quote-calculation')
  @Permissions('itinerary:update')
  async previewQuote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: ItineraryInput,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const actor = await this.service.actor(user, req);
    return moneyResponse(await this.service.previewQuote(id, input, actor));
  }
  @Post(':id/copy')
  @Permissions('itinerary:create')
  async copy(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: CopyItineraryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const actor = await this.service.actor(user, req);
    return moneyResponse(await this.service.copy(id, input, actor));
  }
  @Get(':id/pdf-data')
  @Permissions('itinerary:list')
  async pdf(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const actor = await this.service.actor(user, req);
    return moneyResponse(await this.service.pdfData(id, actor));
  }
  @Post(':id/confirm-pdf')
  @Permissions('itinerary:pdf')
  async confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: ConfirmPdfDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const actor = await this.service.actor(user, req);
    return moneyResponse(await this.service.confirmPdf(id, input, actor));
  }
}

@ApiTags('Inquiries')
@ApiBearerAuth()
@Controller('inquiry-logs')
export class InquiryLogsController {
  constructor(private readonly service: InquiriesService) {}
  @Get('')
  @Permissions('inquiry:list')
  async list(
    @Query() query: LogQuery,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const actor = await this.service.actor(user, req);
    const result = await this.service.logs(query, actor);
    return { ...result, list: moneyResponse(result.list) };
  }
  @Get('report')
  @Permissions('inquiry:list')
  async report(
    @Query() query: LogQuery,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const actor = await this.service.actor(user, req);
    return moneyResponse(await this.service.report(query, actor));
  }
  @Get('operators')
  @Permissions('inquiry:list')
  async operators(@CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    const actor = await this.service.actor(user, req);
    return moneyResponse(await this.service.operators(actor));
  }
}
