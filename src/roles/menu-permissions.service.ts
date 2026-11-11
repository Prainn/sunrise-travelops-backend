import { effectiveAccountPermissions } from '../auth/identity-permissions';
import { sunrisePermissions } from '../auth/sunrise-menu-access';
import { HttpStatus, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthenticatedUser } from '../auth/auth.types';
import { BusinessException } from '../common/exceptions/business.exception';
import { LoginScope } from '../users/user-identity.entity';
import {
  allowedMenuKeys,
  MENU_DEFINITIONS,
  MENU_GROUPS,
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

  private assertRoot(actor: AuthenticatedUser, permission: string) {
    if (
      actor.scope !== 'headquarters' ||
      !actor.roles.includes('ROOT') ||
      !actor.permissions.includes(permission)
    )
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
    this.assertRoot(actor, 'sys:menu-permission:list');
    const rows = await this.db.query<
      Array<{ code: string; name: string; version: number; menuKeys: string[] }>
    >(
      'SELECT r.code,r.name,c.version,c.menu_keys AS "menuKeys" FROM roles r JOIN role_menu_configs c ON c.role_id=r.id WHERE r.code=ANY($1::text[]) ORDER BY r.code',
      [MENU_ROLES],
    );
    return {
      groups: MENU_GROUPS,
      roles: [
        ...rows.map((row) => this.present(row)),
        ...(actor.username === 'mango' ? [await this.sunriseConfig()] : []),
      ],
    };
  }

  navigation(actor: AuthenticatedUser) {
    const root =
      actor.username !== 'sunrise' &&
      actor.scope === 'headquarters' &&
      actor.roles.includes('ROOT');
    return {
      groups: MENU_GROUPS.map((group) => ({
        ...group,
        children: group.children.filter(
          (item) =>
            item.scopes.includes(actor.scope) &&
            (item.menuKey !== 'business-groups' ||
              actor.scope === 'headquarters' ||
              actor.roles.includes('BUSINESS_MANAGER')) &&
            (root || actor.menuKeys.includes(item.menuKey)) &&
            item.permissions.some((permission) =>
              actor.permissions.includes(permission),
            ),
        ),
      })).filter((group) => group.children.length > 0),
    };
  }

  private sunriseAllowed(): string[] {
    const permissions = effectiveAccountPermissions(
      'headquarters',
      ['ROOT'],
      null,
      'sunrise',
    );
    return MENU_DEFINITIONS.filter(
      (menu) =>
        roleMenuKeys('ROOT').includes(menu.key) &&
        menu.permissions.some((permission) => permissions.includes(permission)),
    ).map((menu) => menu.key);
  }

  async sunriseConfig(): Promise<RoleMenuConfig> {
    const [row] = await this.db.query<
      { menuKeys: string[]; version: number }[]
    >(
      'SELECT menu_keys AS "menuKeys",version FROM account_menu_configs WHERE username=$1',
      ['sunrise'],
    );
    const allowed = this.sunriseAllowed();
    return {
      code: 'SUNRISE',
      name: 'Sunrise',
      version: row?.version ?? 1,
      menuKeys: row
        ? row.menuKeys.filter((key) => allowed.includes(key))
        : allowed,
      allowedMenuKeys: allowed,
      locked: false,
    };
  }

  async sunriseAccess(permissions: string[]) {
    const config = await this.sunriseConfig();
    return {
      menuKeys: config.menuKeys,
      permissions: sunrisePermissions(permissions, config.menuKeys),
    };
  }

  private async saveSunrise(
    input: { version: number; menuKeys: string[] },
    actor: AuthenticatedUser,
  ) {
    if (actor.username !== 'mango')
      throw new BusinessException({
        code: 'AUTH_FORBIDDEN',
        message: '仅mango可配置Sunrise权限',
        status: HttpStatus.FORBIDDEN,
      });
    const allowed = this.sunriseAllowed();
    if (input.menuKeys.some((key) => !allowed.includes(key)))
      throw new BusinessException({
        code: 'VALIDATION_ERROR',
        message: '菜单不适用于Sunrise账号',
        status: HttpStatus.BAD_REQUEST,
      });
    return this.db.transaction(async (manager) => {
      await manager.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('account-menu:sunrise',0))",
      );
      const [row] = await manager.query<
        { menuKeys: string[]; version: number }[]
      >(
        'SELECT menu_keys AS "menuKeys",version FROM account_menu_configs WHERE username=$1 FOR UPDATE',
        ['sunrise'],
      );
      const version = row?.version ?? 1;
      if (input.version !== version)
        throw new BusinessException({
          code: 'CONFLICT',
          message: '菜单配置已更新，请重新加载',
          status: HttpStatus.CONFLICT,
          details: { currentVersion: version },
        });
      await manager.query(
        `INSERT INTO account_menu_configs(username,menu_keys,version,updated_by) VALUES('sunrise',$1,$2,$3)
        ON CONFLICT(username) DO UPDATE SET menu_keys=EXCLUDED.menu_keys,version=EXCLUDED.version,updated_by=EXCLUDED.updated_by,updated_at=now()`,
        [input.menuKeys, version + 1, actor.id],
      );
      return {
        role: {
          code: 'SUNRISE',
          name: 'Sunrise',
          version: version + 1,
          menuKeys: input.menuKeys,
          allowedMenuKeys: allowed,
          locked: false,
        },
        beforeMenuKeys: row?.menuKeys ?? allowed,
      };
    });
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
    this.assertRoot(actor, 'sys:menu-permission:update');
    if (code === 'SUNRISE') return this.saveSunrise(input, actor);
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
