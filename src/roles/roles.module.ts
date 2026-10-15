import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PermissionEntity } from './permission.entity';
import { RoleEntity } from './role.entity';
import { MenuPermissionsService } from './menu-permissions.service';
import { MenuPermissionsController } from './menu-permissions.controller';

@Module({
  imports: [TypeOrmModule.forFeature([RoleEntity, PermissionEntity])],
  controllers: [MenuPermissionsController],
  providers: [MenuPermissionsService],
  exports: [TypeOrmModule, MenuPermissionsService],
})
export class RolesModule {}
