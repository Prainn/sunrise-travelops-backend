import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PermissionEntity } from './permission.entity';
import { RoleEntity } from './role.entity';

@Module({
  imports: [TypeOrmModule.forFeature([RoleEntity, PermissionEntity])],
  exports: [TypeOrmModule],
})
export class RolesModule {}
