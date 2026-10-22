import { Body, Controller, Get, Param, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Request } from 'express';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { MenuPermissionsService } from './menu-permissions.service';
import { MENU_DEFINITIONS } from './menu-definitions';
import {
  MenuNavigationResponse,
  MenuPermissionsResponse,
  RoleMenuConfigResponse,
} from './menu-navigation.dto';
import {
  ApiCommonErrorResponses,
  ApiSuccessResponse,
} from '../common/swagger/api-response.decorator';

export class SaveMenuPermissionsDto {
  @IsInt() @Min(1) version: number;
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(MENU_DEFINITIONS.length)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  menuKeys: string[];
}

@ApiTags('Menu permissions')
@ApiBearerAuth()
@ApiCommonErrorResponses()
@Controller('system/menu-permissions')
export class MenuPermissionsController {
  constructor(private readonly service: MenuPermissionsService) {}
  @Get()
  @Permissions('sys:menu-permission:list')
  @ApiOperation({ summary: '读取角色菜单配置（仅总部 ROOT）' })
  @ApiSuccessResponse({ type: MenuPermissionsResponse })
  list(@CurrentUser() actor: AuthenticatedUser) {
    return this.service.list(actor);
  }

  @Get('navigation')
  @ApiOperation({ summary: '读取当前登录身份的有序侧边栏菜单' })
  @ApiSuccessResponse({ type: MenuNavigationResponse })
  navigation(@CurrentUser() actor: AuthenticatedUser) {
    return this.service.navigation(actor);
  }

  @Put(':roleCode')
  @Permissions('sys:menu-permission:update')
  @ApiOperation({ summary: '保存角色菜单配置（下次登录生效）' })
  @ApiSuccessResponse({ type: RoleMenuConfigResponse })
  async save(
    @Param('roleCode') code: string,
    @Body() input: SaveMenuPermissionsDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request & { menuPermissionChange?: unknown },
  ) {
    const result = await this.service.save(code, input, actor);
    request.menuPermissionChange = {
      roleCode: code,
      beforeMenuKeys: result.beforeMenuKeys,
      afterMenuKeys: result.role.menuKeys,
    };
    return result.role;
  }
}
