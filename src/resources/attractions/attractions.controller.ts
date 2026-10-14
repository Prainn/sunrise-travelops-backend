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
  AttractionResponse,
  AttractionQueryDto,
  CreateAttractionDto,
  UpdateAttractionDto,
} from './dto/attraction.dto';
import { AttractionsService } from './attractions.service';
@ApiTags('Resources')
@ApiBearerAuth()
@ApiCommonErrorResponses()
@Controller('resources/attractions')
export class AttractionsController {
  constructor(private readonly service: AttractionsService) {}
  @Get()
  @Permissions('resource:attraction:list')
  @ApiOperation({ summary: 'List attractions' })
  @ApiPaginatedResponse(AttractionResponse)
  list(@Query() query: AttractionQueryDto) {
    return this.service.list(query);
  }
  @Get(':id')
  @Permissions('resource:attraction:list')
  @ApiOperation({ summary: 'Get an attraction' })
  @ApiSuccessResponse({ type: AttractionResponse })
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.get(id);
  }
  @Post()
  @Permissions('resource:attraction:create')
  @ApiOperation({ summary: 'Create an attraction' })
  @ApiSuccessResponse({
    status: HttpStatus.CREATED,
    type: AttractionResponse,
  })
  create(
    @Body() input: CreateAttractionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(input, user.id);
  }
  @Put(':id')
  @Permissions('resource:attraction:update')
  @ApiOperation({ summary: 'Update an attraction' })
  @ApiSuccessResponse({ type: AttractionResponse })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateAttractionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, input, user.id);
  }
  @Delete()
  @Permissions('resource:attraction:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete attractions' })
  @ApiNoContentResponse()
  delete(
    @Query() query: BatchIdsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.delete(query.ids, user.id);
  }
}
