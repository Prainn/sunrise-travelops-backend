import { HttpStatus, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthenticatedUser } from '../auth/auth.types';
import { BusinessException } from '../common/exceptions/business.exception';
import { LoginScope } from '../users/user-identity.entity';
import {
  allowedMenuKeys,
  MENU_DEFINITIONS,
  MENU_ROLES,
  roleMenuKeys,
} from './menu-definitions';

export interface RoleMenuConfig {
  code: string;
  name: string;
  version: number;
  menuKeys: string[];
  allowedMenuKeys: string[];
  locked: boolean;
}

@Injectable()
export class MenuPermissionsService {
  constructor(private readonly db: DataSource) {}

  private assertRoot(actor: AuthenticatedUser) {
    if (actor.scope !== 'headquarters' || !actor.roles.includes('ROOT'))
      throw new BusinessException({
        code: 'AUTH_FORBIDDEN',
        message: '仅超级管理员可配置菜单权限',
        status: HttpStatus.FORBIDDEN,
      });
  }

  private present(row: {
    code: string;
    name: string;
    version: number;
    menuKeys: string[];
  }): RoleMenuConfig {
    const allowed = roleMenuKeys(row.code);
    return {
      ...row,
      allowedMenuKeys: allowed,
      menuKeys:
        row.code === 'ROOT'
          ? allowed
          : row.menuKeys.filter((key) => allowed.includes(key)),
      locked: row.code === 'ROOT',
    };
  }

  async list(actor: AuthenticatedUser) {
    this.assertRoot(actor);
    const rows = await this.db.query<
      Array<{ code: string; name: string; version: number; menuKeys: string[] }>
    >(
      'SELECT r.code,r.name,c.version,c.menu_keys AS "menuKeys" FROM roles r JOIN role_menu_configs c ON c.role_id=r.id WHERE r.code=ANY($1::text[]) ORDER BY r.code',
      [MENU_ROLES],
    );
    return {
      menus: MENU_DEFINITIONS,
      roles: rows.map((row) => this.present(row)),
    };
  }

  async snapshot(scope: LoginScope, roles: string[]): Promise<string[]> {
    const allowed = allowedMenuKeys(scope, roles);
    if (scope === 'headquarters' && roles.includes('ROOT')) return allowed;
    const rows = await this.db.query<Array<{ menuKeys: string[] }>>(
      'SELECT c.menu_keys AS "menuKeys" FROM role_menu_configs c JOIN roles r ON r.id=c.role_id WHERE r.code=ANY($1::text[]) AND r.is_enabled=true',
      [roles],
    );
    const configured = new Set(rows.flatMap((row) => row.menuKeys));
    return allowed.filter((key) => configured.has(key));
  }

  async save(
    code: string,
    input: { version: number; menuKeys: string[] },
    actor: AuthenticatedUser,
  ) {
    this.assertRoot(actor);
    return this.db.transaction(async (manager) => {
      const [row] = await manager.query<
        Array<{
          id: string;
          code: string;
          name: string;
          version: number;
          menuKeys: string[];
        }>
      >(
        'SELECT r.id,r.code,r.name,c.version,c.menu_keys AS "menuKeys" FROM roles r JOIN role_menu_configs c ON c.role_id=r.id WHERE r.code=$1 FOR UPDATE OF c',
        [code],
      );
      if (!row)
        throw new BusinessException({
          code: 'NOT_FOUND',
          message: '角色不存在',
          status: HttpStatus.NOT_FOUND,
        });
      if (
        code === 'ROOT' ||
        !MENU_ROLES.includes(code as (typeof MENU_ROLES)[number]) ||
        input.menuKeys.some((key) => !roleMenuKeys(code).includes(key))
      )
        throw new BusinessException({
          code: 'VALIDATION_ERROR',
          message: '菜单不适用于该角色',
          status: HttpStatus.BAD_REQUEST,
        });
      if (row.version !== input.version)
        throw new BusinessException({
          code: 'CONFLICT',
          message: '菜单配置已更新，请重新加载',
          status: HttpStatus.CONFLICT,
          details: { currentVersion: row.version },
        });
      await manager.query(
        'UPDATE role_menu_configs SET menu_keys=$1::text[],version=version+1,updated_by=$2,updated_at=now() WHERE role_id=$3',
        [input.menuKeys, actor.id, row.id],
      );
      return {
        role: this.present({
          code: row.code,
          name: row.name,
          version: row.version + 1,
          menuKeys: input.menuKeys,
        }),
        beforeMenuKeys: row.menuKeys,
      };
    });
  }
}
