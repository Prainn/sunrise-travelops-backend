import { ApiProperty } from '@nestjs/swagger';
import type { LoginScope } from '../users/user-identity.entity';
import type {
  MenuNavigationGroup,
  MenuNavigationItem,
} from './menu-definitions';
import type { RoleMenuConfig } from './menu-permissions.service';

export class MenuNavigationItemResponse implements MenuNavigationItem {
  @ApiProperty({ description: 'Unique display node key; not a grant key' })
  key: string;
  @ApiProperty({ description: 'Persisted role/JWT menu grant key' })
  menuKey: string;
  @ApiProperty({ description: 'Existing route.* i18n suffix' })
  title: string;
  @ApiProperty({ description: 'Registered frontend route name' })
  routeName: string;
  @ApiProperty({ type: [String] }) scopes: LoginScope[];
  @ApiProperty({
    type: [String],
    description: 'Any matching permission allows the page',
  })
  permissions: string[];
}

export class MenuNavigationGroupResponse implements MenuNavigationGroup {
  @ApiProperty() key: string;
  @ApiProperty() title: string;
  @ApiProperty() routeName: string;
  @ApiProperty({ type: [MenuNavigationItemResponse] })
  children: MenuNavigationItemResponse[];
}

export class MenuNavigationResponse {
  @ApiProperty({ type: [MenuNavigationGroupResponse] })
  groups: MenuNavigationGroupResponse[];
}

export class RoleMenuConfigResponse implements RoleMenuConfig {
  @ApiProperty() code: string;
  @ApiProperty() name: string;
  @ApiProperty() version: number;
  @ApiProperty({ type: [String] }) menuKeys: string[];
  @ApiProperty({ type: [String] }) allowedMenuKeys: string[];
  @ApiProperty() locked: boolean;
}

export class MenuPermissionsResponse extends MenuNavigationResponse {
  @ApiProperty({ type: [RoleMenuConfigResponse] })
  roles: RoleMenuConfigResponse[];
}
