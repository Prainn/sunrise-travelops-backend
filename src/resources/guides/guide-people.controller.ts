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
  UseInterceptors,
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
import { ResourceScopeInterceptor } from '../common/resource-scope';
import {
  CreateGuidePersonDto,
  GuidePersonQueryDto,
  GuidePersonResponse,
  UpdateGuidePersonDto,
} from './dto/guide-person.dto';
import { GuidePeopleService } from './guide-people.service';

@ApiTags('Resources')
@ApiBearerAuth()
@ApiCommonErrorResponses()
@UseInterceptors(ResourceScopeInterceptor)
@Controller('resources/guide-people')
export class GuidePeopleController {
  constructor(private readonly service: GuidePeopleService) {}

  @Get()
  @Permissions('resource:guide:list')
  @ApiOperation({ summary: 'List guide people' })
  @ApiPaginatedResponse(GuidePersonResponse)
  list(@Query() query: GuidePersonQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  @Permissions('resource:guide:list')
  @ApiOperation({ summary: 'Get a guide person' })
  @ApiSuccessResponse({ type: GuidePersonResponse })
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.get(id);
  }

  @Post()
  @Permissions('resource:guide:create')
  @ApiOperation({ summary: 'Create a guide person' })
  @ApiSuccessResponse({ status: HttpStatus.CREATED, type: GuidePersonResponse })
  create(
    @Body() input: CreateGuidePersonDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(input, user.id);
  }

  @Put(':id')
  @Permissions('resource:guide:update')
  @ApiOperation({ summary: 'Update a guide person' })
  @ApiSuccessResponse({ type: GuidePersonResponse })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateGuidePersonDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, input, user.id);
  }

  @Delete()
  @Permissions('resource:guide:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete guide people' })
  @ApiNoContentResponse()
  delete(
    @Query() query: BatchIdsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.delete(query.ids, user.id);
  }
}
