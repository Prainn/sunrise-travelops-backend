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

export class SaveMenuPermissionsDto {
  @IsInt() @Min(1) version: number;
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(19)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  menuKeys: string[];
}

@ApiTags('Menu permissions')
@ApiBearerAuth()
@Controller('system/menu-permissions')
export class MenuPermissionsController {
  constructor(private readonly service: MenuPermissionsService) {}
  @Get()
  @Permissions('sys:menu-permission:list')
  @ApiOperation({ summary: '读取角色菜单配置（仅总部 ROOT）' })
  list(@CurrentUser() actor: AuthenticatedUser) {
    return this.service.list(actor);
  }

  @Put(':roleCode')
  @Permissions('sys:menu-permission:update')
  @ApiOperation({ summary: '保存角色菜单配置（下次登录生效）' })
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
