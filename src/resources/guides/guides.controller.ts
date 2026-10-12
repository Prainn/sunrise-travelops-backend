import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AuthenticatedUser } from '../../auth/auth.types';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import {
  ApiCommonErrorResponses,
  ApiPaginatedResponse,
  ApiSuccessResponse,
} from '../../common/swagger/api-response.decorator';
import { BatchIdsQueryDto } from '../common/resource.dto';
import {
  CreateGuideDto,
  GuideQueryDto,
  GuideResponse,
  UpdateGuideDto,
} from './dto/guide.dto';
import { GuidesService } from './guides.service';
@ApiTags('Resources')
@ApiBearerAuth()
@ApiCommonErrorResponses()
@Controller('resources/guides')
export class GuidesController {
  constructor(private readonly service: GuidesService) {}
  @Get()
  @Permissions('resource:guide:list')
  @ApiOperation({ summary: 'List guides' })
  @ApiPaginatedResponse(GuideResponse)
  list(@Query() query: GuideQueryDto) {
    return this.service.list(query);
  }
  @Get(':id')
  @Permissions('resource:guide:list')
  @ApiOperation({ summary: 'Get a guide' })
  @ApiSuccessResponse({ type: GuideResponse })
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.get(id);
  }
  @Post()
  @Permissions('resource:guide:create')
  @ApiOperation({ summary: 'Create a guide' })
  @ApiSuccessResponse({ status: HttpStatus.CREATED, type: GuideResponse })
  create(
    @Body() input: CreateGuideDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(input, user.id);
  }
  @Put(':id')
  @Permissions('resource:guide:update')
  @ApiOperation({ summary: 'Update a guide' })
  @ApiSuccessResponse({ type: GuideResponse })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateGuideDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, input, user.id);
  }
  @Delete()
  @Permissions('resource:guide:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete guides' })
  @ApiNoContentResponse()
  delete(
    @Query() query: BatchIdsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.delete(query.ids, user.id);
  }
}
