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
import {
  BatchIdsQueryDto,
  DictionaryCodeParamDto,
  DictionaryItemInputDto,
  DictionaryItemParamDto,
  DictionaryItemQueryDto,
  DictionaryItemResponse,
  DictionaryItemOptionResponse,
  DictionaryTypeInputDto,
  DictionaryTypeOptionResponse,
  DictionaryTypeQueryDto,
  DictionaryTypeResponse,
} from './dto/dictionary.dto';
import { SystemDictionariesService } from './system-dictionaries.service';

@ApiTags('System')
@ApiBearerAuth()
@ApiCommonErrorResponses()
@Controller('system/dictionaries')
export class SystemDictionariesController {
  constructor(private readonly dictionaries: SystemDictionariesService) {}

  @Get()
  @Permissions('sys:dict:list')
  @ApiOperation({ summary: 'List dictionary types' })
  @ApiPaginatedResponse(
    DictionaryTypeResponse,
    'Paginated dictionary type list',
  )
  getDictionaryTypePage(@Query() query: DictionaryTypeQueryDto) {
    return this.dictionaries.getDictionaryTypePage(query);
  }

  @Get('options')
  @Permissions('sys:dict:list')
  @ApiOperation({ summary: 'List enabled dictionary types as options' })
  @ApiSuccessResponse({
    type: DictionaryTypeOptionResponse,
    isArray: true,
    description: 'Enabled dictionary type options',
  })
  getDictionaryTypeOptions() {
    return this.dictionaries.getDictionaryTypeOptions();
  }

  @Get(':id')
  @Permissions('sys:dict:list')
  @ApiOperation({ summary: 'Get one dictionary type' })
  @ApiSuccessResponse({
    type: DictionaryTypeResponse,
    description: 'Dictionary type form data',
  })
  getDictionaryType(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.dictionaries.getDictionaryType(id);
  }

  @Post()
  @Permissions('sys:dict:create')
  @ApiOperation({ summary: 'Create a dictionary type' })
  @ApiSuccessResponse({
    status: HttpStatus.CREATED,
    type: DictionaryTypeResponse,
    description: 'Created dictionary type',
  })
  createDictionaryType(
    @Body() input: DictionaryTypeInputDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.dictionaries.createDictionaryType(input, user.id);
  }

  @Put(':id')
  @Permissions('sys:dict:update')
  @ApiOperation({ summary: 'Update a dictionary type' })
  @ApiSuccessResponse({
    type: DictionaryTypeResponse,
    description: 'Updated dictionary type',
  })
  updateDictionaryType(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: DictionaryTypeInputDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.dictionaries.updateDictionaryType(id, input, user.id);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Permissions('sys:dict:delete')
  @ApiOperation({ summary: 'Soft-delete dictionary types and their items' })
  @ApiNoContentResponse()
  deleteDictionaryTypes(
    @Query() query: BatchIdsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.dictionaries.deleteDictionaryTypes(query.ids, user.id);
  }

  @Get(':dictCode/items')
  @Permissions('sys:dict-item:list')
  @ApiOperation({ summary: 'List items for a dictionary type' })
  @ApiPaginatedResponse(
    DictionaryItemResponse,
    'Paginated dictionary item list',
  )
  getDictionaryItemPage(
    @Param() params: DictionaryCodeParamDto,
    @Query() query: DictionaryItemQueryDto,
  ) {
    return this.dictionaries.getDictionaryItemPage(params.dictCode, query);
  }

  @Get(':dictCode/items/options')
  @ApiOperation({ summary: 'List enabled dictionary items as options' })
  @ApiSuccessResponse({
    type: DictionaryItemOptionResponse,
    isArray: true,
    description: 'Enabled dictionary item options',
  })
  getDictionaryItemOptions(@Param() params: DictionaryCodeParamDto) {
    return this.dictionaries.getDictionaryItemOptions(params.dictCode);
  }

  @Get(':dictCode/items/:id')
  @Permissions('sys:dict-item:list')
  @ApiOperation({ summary: 'Get one dictionary item' })
  @ApiSuccessResponse({
    type: DictionaryItemResponse,
    description: 'Dictionary item form data',
  })
  getDictionaryItem(@Param() params: DictionaryItemParamDto) {
    return this.dictionaries.getDictionaryItem(params.dictCode, params.id);
  }

  @Post(':dictCode/items')
  @Permissions('sys:dict-item:create')
  @ApiOperation({ summary: 'Create a dictionary item' })
  @ApiSuccessResponse({
    status: HttpStatus.CREATED,
    type: DictionaryItemResponse,
    description: 'Created dictionary item',
  })
  createDictionaryItem(
    @Param() params: DictionaryCodeParamDto,
    @Body() input: DictionaryItemInputDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.dictionaries.createDictionaryItem(
      params.dictCode,
      input,
      user.id,
    );
  }

  @Put(':dictCode/items/:id')
  @Permissions('sys:dict-item:update')
  @ApiOperation({ summary: 'Update a dictionary item' })
  @ApiSuccessResponse({
    type: DictionaryItemResponse,
    description: 'Updated dictionary item',
  })
  updateDictionaryItem(
    @Param() params: DictionaryItemParamDto,
    @Body() input: DictionaryItemInputDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.dictionaries.updateDictionaryItem(
      params.dictCode,
      params.id,
      input,
      user.id,
    );
  }

  @Delete(':dictCode/items')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Permissions('sys:dict-item:delete')
  @ApiOperation({ summary: 'Soft-delete dictionary items' })
  @ApiNoContentResponse()
  deleteDictionaryItems(
    @Param() params: DictionaryCodeParamDto,
    @Query() query: BatchIdsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.dictionaries.deleteDictionaryItems(
      params.dictCode,
      query.ids,
      user.id,
    );
  }
}
