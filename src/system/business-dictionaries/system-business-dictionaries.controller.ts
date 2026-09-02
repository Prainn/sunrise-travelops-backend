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
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AuthenticatedUser } from '../../auth/auth.types';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import {
  BusinessDictionaryBatchIdsQueryDto,
  BusinessDictionaryCodeParamDto,
  BusinessDictionaryItemInputDto,
  BusinessDictionaryItemParamDto,
  BusinessDictionaryItemQueryDto,
  BusinessDictionaryTypeInputDto,
} from './dto/business-dictionary.dto';
import { SystemBusinessDictionariesService } from './system-business-dictionaries.service';

@ApiTags('System')
@ApiBearerAuth()
@Controller('system/business-dictionaries')
export class SystemBusinessDictionariesController {
  constructor(
    private readonly businessDictionaries: SystemBusinessDictionariesService,
  ) {}

  @Get()
  @Permissions('sys:business-dictionary:list')
  @ApiOperation({ summary: 'List business dictionary types and their items' })
  @ApiOkResponse({ description: 'Business dictionary types' })
  getDictionaryTypes() {
    return this.businessDictionaries.getDictionaryTypes();
  }

  @Post()
  @Permissions('sys:business-dictionary:create')
  @ApiOperation({ summary: 'Create a business dictionary type' })
  @ApiCreatedResponse({ description: 'Created business dictionary type' })
  createDictionaryType(
    @Body() input: BusinessDictionaryTypeInputDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.businessDictionaries.createDictionaryType(input, user.id);
  }

  @Put(':id')
  @Permissions('sys:business-dictionary:update')
  @ApiOperation({ summary: 'Update a business dictionary type' })
  @ApiOkResponse({ description: 'Updated business dictionary type' })
  updateDictionaryType(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: BusinessDictionaryTypeInputDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.businessDictionaries.updateDictionaryType(id, input, user.id);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Permissions('sys:business-dictionary:delete')
  @ApiOperation({ summary: 'Soft-delete custom business dictionary types' })
  @ApiNoContentResponse()
  deleteDictionaryTypes(
    @Query() query: BusinessDictionaryBatchIdsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.businessDictionaries.deleteDictionaryTypes(query.ids, user.id);
  }

  @Get(':typeCode/items')
  @Permissions('sys:business-dictionary:list')
  @ApiOperation({ summary: 'List items in a business dictionary type' })
  @ApiOkResponse({ description: 'Business dictionary items' })
  getDictionaryItems(
    @Param() params: BusinessDictionaryCodeParamDto,
    @Query() query: BusinessDictionaryItemQueryDto,
  ) {
    return this.businessDictionaries.getDictionaryItems(params.typeCode, query);
  }

  @Post(':typeCode/items')
  @Permissions('sys:business-dictionary:create')
  @ApiOperation({ summary: 'Create a business dictionary item' })
  @ApiCreatedResponse({ description: 'Created business dictionary item' })
  createDictionaryItem(
    @Param() params: BusinessDictionaryCodeParamDto,
    @Body() input: BusinessDictionaryItemInputDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.businessDictionaries.createDictionaryItem(
      params.typeCode,
      input,
      user.id,
    );
  }

  @Put(':typeCode/items/:id')
  @Permissions('sys:business-dictionary:update')
  @ApiOperation({ summary: 'Update a business dictionary item' })
  @ApiOkResponse({ description: 'Updated business dictionary item' })
  updateDictionaryItem(
    @Param() params: BusinessDictionaryItemParamDto,
    @Body() input: BusinessDictionaryItemInputDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.businessDictionaries.updateDictionaryItem(
      params.typeCode,
      params.id,
      input,
      user.id,
    );
  }

  @Delete(':typeCode/items')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Permissions('sys:business-dictionary:delete')
  @ApiOperation({ summary: 'Soft-delete business dictionary items' })
  @ApiNoContentResponse()
  deleteDictionaryItems(
    @Param() params: BusinessDictionaryCodeParamDto,
    @Query() query: BusinessDictionaryBatchIdsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.businessDictionaries.deleteDictionaryItems(
      params.typeCode,
      query.ids,
      user.id,
    );
  }
}
