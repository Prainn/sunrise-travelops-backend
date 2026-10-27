import {
  HttpCode,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import {
  WebsiteConfigDto,
  WebsiteConfigListQuery,
  WebsiteConfigRecordDto,
  WebsiteConfigVersionDto,
  WebsiteConfigQuery,
  WebsiteConfirmDto,
  WebsiteCreateItineraryDto,
  WebsiteGenerateDto,
  WebsiteCreateInquiryDto,
  WebsiteBusinessQuery,
  WebsiteInquiryQuery,
  WebsiteLogQuery,
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
  @Get('guide-languages')
  @Permissions('website:itinerary:list')
  @ApiOperation({ summary: '导游资料语言分页选项，可手填其他语言' })
  guideLanguages(
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.guideLanguages(query, user);
  }
  @Post('itineraries/:id/validate')
  @HttpCode(200)
  @Permissions('website:itinerary:update')
  @ApiOperation({ summary: '校验未保存的行程调整并生成双语预览，不写库' })
  validateItinerary(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: WebsiteUpdateItineraryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.validateItinerary(id, input, user);
  }
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
    @Body() input: WebsiteCreateInquiryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(input, user);
  }
  @Get('owners')
  @Permissions('website:inquiry:list')
  owners(
    @Query() query: WebsiteBusinessQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.owners(user, query.businessUnit);
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
  @Delete('inquiries/:id')
  @HttpCode(204)
  @Permissions('website:inquiry:delete')
  @ApiOperation({ summary: '软删除询盘：收客计调本人负责、负责人本业务全部' })
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: WebsiteVersionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.service.delete(id, input.version, user);
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
  @Get('inquiries/:id/itineraries')
  @Permissions('website:itinerary:list')
  itineraries(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.itineraries(id, user);
  }
  @Get('inquiry-logs')
  @Permissions('website:inquiry:list')
  @ApiOperation({ summary: '独立站询盘日志分页（按当前询盘归属及负责人授权）' })
  @ApiOkResponse({
    description:
      'data: {list: WebsiteInquiryLog[],total,page,pageSize}；历史 changes 为 null。详见统一 API §18.2.1。',
  })
  inquiryLogs(
    @Query() query: WebsiteLogQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.inquiryLogs(query, user);
  }
  @Get('inquiry-logs/report')
  @Permissions('website:inquiry:list')
  @ApiOperation({
    summary: '独立站询盘日志汇总（忽略分页，筛选范围与明细一致）',
  })
  @ApiOkResponse({
    description:
      'data: {totalOperations,inquiryCount,operatorCount,changedFields,logsWithoutChanges,byAction:[{action,count}]}。',
  })
  inquiryLogReport(
    @Query() query: WebsiteLogQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.inquiryLogReport(query, user);
  }
  @Get('inquiry-logs/operators')
  @Permissions('website:inquiry:list')
  @ApiOperation({
    summary: '可见独立站日志中的历史操作人选项（每人最近一次匹配日志）',
  })
  @ApiOkResponse({
    description:
      'data: [{id,name,username:string|null}]；忽略分页，前端获取选项时省略 operatorId。',
  })
  inquiryLogOperators(
    @Query() query: WebsiteLogQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.inquiryLogOperators(query, user);
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
    return this.service.getConfig(user, query.version, query.businessUnit);
  }
  @Get('config/:group/options')
  @Permissions('website:config:list')
  @ApiOperation({ summary: '专属配置关联项分页选项' })
  configOptions(
    @Param('group') group: string,
    @Query() query: WebsiteConfigListQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.configOptions(group, query, user);
  }
  @Get('config/:group')
  @Permissions('website:config:list')
  @ApiOperation({ summary: '按标签页分页读取专属配置及本页关联名称' })
  configRecords(
    @Param('group') group: string,
    @Query() query: WebsiteConfigListQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.configRecords(group, query, user);
  }
  @Post('config/:group')
  @Permissions('website:config:update')
  @ApiOperation({ summary: '新增一条配置并生成新配置版本' })
  createConfigRecord(
    @Param('group') group: string,
    @Query() query: WebsiteBusinessQuery,
    @Body() input: WebsiteConfigRecordDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.mutateConfigRecord(
      'create',
      group,
      undefined,
      input,
      user,
      query.businessUnit,
    );
  }
  @Put('config/:group/:id')
  @Permissions('website:config:update')
  @ApiOperation({ summary: '更新一条配置并生成新配置版本' })
  updateConfigRecord(
    @Param('group') group: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: WebsiteBusinessQuery,
    @Body() input: WebsiteConfigRecordDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.mutateConfigRecord(
      'update',
      group,
      id,
      input,
      user,
      query.businessUnit,
    );
  }
  @Delete('config/:group/:id')
  @Permissions('website:config:update')
  @ApiOperation({ summary: '删除一条配置并生成新配置版本，保留历史快照' })
  deleteConfigRecord(
    @Param('group') group: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: WebsiteBusinessQuery,
    @Body() input: WebsiteConfigVersionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.mutateConfigRecord(
      'delete',
      group,
      id,
      input,
      user,
      query.businessUnit,
    );
  }
  @Put('config')
  @Permissions('website:config:update')
  saveConfig(
    @Query() query: WebsiteBusinessQuery,
    @Body() input: WebsiteConfigDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.saveConfig(input, user, query.businessUnit);
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
  @Get('resources/:kind/:id')
  @Permissions('website:config:list')
  @ApiOperation({
    summary: '按公共资源 ID 读取简要信息（含停用主体，不含已删除主体）',
  })
  @ApiParam({
    name: 'kind',
    enum: ['city', 'attraction', 'hotel', 'restaurant', 'transport'],
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({
    description:
      '标准成功包装的 data 为单个资源；city 仅酒店/餐厅/景点返回，seats 仅车型返回。',
    schema: {
      type: 'object',
      properties: {
        code: { type: 'string', example: 'SUCCESS' },
        message: { type: 'string' },
        data: {
          type: 'object',
          required: ['id', 'name', 'status'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            status: { type: 'string', enum: ['enabled', 'disabled'] },
            city: { type: 'string', nullable: true },
            seats: { type: 'integer' },
          },
        },
      },
    },
  })
  resource(
    @Param('kind') kind: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.resource(kind, id, user);
  }
}
