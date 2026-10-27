import { AccountLinksController } from './account-links.controller';
import { AccountLinksService } from './account-links.service';
import { BusinessGroupEntity } from './business-group.entity';
import { BusinessGroupsController } from './business-groups.controller';
import { BusinessGroupsService } from './business-groups.service';
import { UserIdentityEntity } from './user-identity.entity';
import { FeishuModule } from '../feishu/feishu.module';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoleEntity } from '../roles/role.entity';
import { UserEntity } from './user.entity';
import { UserManagementController } from './user-management.controller';
import { UserManagementService } from './user-management.service';

@Module({
  imports: [
    FeishuModule,
    TypeOrmModule.forFeature([
      UserIdentityEntity,
      UserEntity,
      RoleEntity,
      BusinessGroupEntity,
    ]),
  ],
  controllers: [
    UserManagementController,
    BusinessGroupsController,
    AccountLinksController,
  ],
  providers: [
    UserManagementService,
    BusinessGroupsService,
    AccountLinksService,
  ],
  exports: [TypeOrmModule, AccountLinksService],
})
export class UsersModule {}
