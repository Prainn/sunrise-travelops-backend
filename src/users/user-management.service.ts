import { randomBytes } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { DataSource, In, Repository } from 'typeorm';
import { BusinessException } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/constants/error-code';
import { PageResult } from '../common/types/page-result';
import { RoleEntity } from '../roles/role.entity';
import {
  CreateUserDto,
  CreatedUserResponse,
  UserItemResponse,
  UserQueryDto,
  UpdateUserDto,
} from './dto/user-management.dto';
import { UserEntity, UserStatus } from './user.entity';
import {
  DEPARTMENT_OPTIONS,
  ROOT_ROLE_CODE,
} from './user-management.constants';

@Injectable()
export class UserManagementService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    @InjectRepository(RoleEntity)
    private readonly roles: Repository<RoleEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async getPage(query: UserQueryDto): Promise<PageResult<UserItemResponse>> {
    const builder = this.users
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.roles', 'role')
      .orderBy('user.createdAt', 'ASC')
      .addOrderBy('user.id', 'ASC');

    const keyword = query.keyword?.trim() || undefined;
    if (keyword) {
      builder.andWhere(
        '(user.username ILIKE :keyword OR user.nickname ILIKE :keyword OR user.mobile ILIKE :keyword)',
        { keyword: `%${keyword}%` },
      );
    }
    if (query.status !== undefined) {
      builder.andWhere('user.status = :status', {
        status: query.status === 1 ? UserStatus.Enabled : UserStatus.Disabled,
      });
    }
    if (query.deptId !== undefined) {
      builder.andWhere('user.deptId = :deptId', { deptId: query.deptId });
    }
    if (query.roleId) {
      builder.andWhere(
        `EXISTS (
          SELECT 1 FROM user_roles role_filter
          WHERE role_filter.user_id = user.id AND role_filter.role_id = :roleId
        )`,
        { roleId: query.roleId },
      );
    }
    if (query.createTime?.[0]) {
      builder.andWhere('user.createdAt::date >= :startDate', {
        startDate: query.createTime[0],
      });
    }
    if (query.createTime?.[1]) {
      builder.andWhere('user.createdAt::date <= :endDate', {
        endDate: query.createTime[1],
      });
    }

    const page = query.page;
    const [entities, total] = await builder
      .skip((page - 1) * query.pageSize)
      .take(query.pageSize)
      .getManyAndCount();
    return {
      list: entities.map((entity) => this.toResponse(entity)),
      total,
      page,
      pageSize: query.pageSize,
    };
  }

  async getFormData(id: string): Promise<UserItemResponse> {
    return this.toResponse(await this.requireUser(id));
  }

  async getRoleOptions(): Promise<Array<{ value: string; label: string }>> {
    const roles = await this.roles.find({
      where: { isEnabled: true },
      order: { createdAt: 'ASC', name: 'ASC' },
    });
    return roles
      .filter((role) => role.code !== ROOT_ROLE_CODE)
      .map((role) => ({ value: role.id, label: role.name }));
  }

  getDepartmentOptions(): Array<{ value: number; label: string }> {
    return DEPARTMENT_OPTIONS.map((option) => ({ ...option }));
  }

  async create(
    input: CreateUserDto,
    actorId: string,
  ): Promise<CreatedUserResponse> {
    await this.ensureUsernameAvailable(input.username);
    const roles = await this.requireAssignableRoles(input.roleIds);
    this.requireDepartment(input.deptId);
    const temporaryPassword = input.password ?? this.generatePassword();
    const entity = this.users.create({
      username: input.username,
      passwordHash: await argon2.hash(temporaryPassword),
      nickname: input.nickname,
      avatar: input.avatar,
      gender: input.gender,
      mobile: input.mobile,
      email: input.email,
      deptId: input.deptId,
      status: this.toUserStatus(input.status),
      refreshTokenHash: null,
      roles,
      createdBy: actorId,
      updatedBy: actorId,
    });
    const saved = await this.users.save(entity);
    return {
      ...this.toResponse(saved),
      ...(input.password ? {} : { temporaryPassword }),
    };
  }

  async update(
    id: string,
    input: UpdateUserDto,
    actorId: string,
  ): Promise<UserItemResponse> {
    this.assertMatchingId(input.id, id);
    const entity = await this.requireUser(id);
    if (input.username && input.username !== entity.username) {
      throw new BusinessException({
        code: ErrorCode.USERNAME_IMMUTABLE,
        message: 'Username cannot be changed',
        status: HttpStatus.CONFLICT,
      });
    }
    if (id === actorId && input.status === 0) {
      throw new BusinessException({
        code: ErrorCode.CURRENT_USER_CANNOT_BE_DISABLED,
        message: 'The current user cannot disable their own account',
        status: HttpStatus.CONFLICT,
      });
    }
    this.requireDepartment(input.deptId);
    const assignableRoles = await this.requireAssignableRoles(input.roleIds);
    const rootRoles = entity.roles.filter(
      (role) => role.code === ROOT_ROLE_CODE,
    );
    entity.nickname = input.nickname;
    entity.avatar = input.avatar;
    entity.gender = input.gender;
    entity.mobile = input.mobile;
    entity.email = input.email;
    entity.deptId = input.deptId;
    entity.status = this.toUserStatus(input.status);
    entity.roles = [...rootRoles, ...assignableRoles];
    entity.updatedBy = actorId;
    if (entity.status === UserStatus.Disabled) entity.refreshTokenHash = null;
    return this.toResponse(await this.users.save(entity));
  }

  async delete(ids: string[], actorId: string): Promise<void> {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.includes(actorId)) {
      throw new BusinessException({
        code: ErrorCode.CURRENT_USER_CANNOT_BE_DELETED,
        message: 'The current user cannot delete their own account',
        status: HttpStatus.CONFLICT,
      });
    }
    const entities = await this.users.find({
      where: { id: In(uniqueIds) },
      relations: { roles: true },
    });
    this.assertAllUsersFound(uniqueIds, entities);
    if (
      entities.some((entity) =>
        entity.roles.some((role) => role.code === ROOT_ROLE_CODE),
      )
    ) {
      throw new BusinessException({
        code: ErrorCode.ROOT_USER_CANNOT_BE_DELETED,
        message: 'A root user cannot be deleted',
        status: HttpStatus.CONFLICT,
      });
    }

    await this.dataSource.transaction(async (manager) => {
      await manager
        .getRepository(UserEntity)
        .createQueryBuilder()
        .update()
        .set({ updatedBy: actorId, refreshTokenHash: null })
        .where('id IN (:...ids)', { ids: uniqueIds })
        .andWhere('deleted_at IS NULL')
        .execute();
      await manager.getRepository(UserEntity).softDelete({ id: In(uniqueIds) });
    });
  }

  async resetPassword(id: string, password: string, actorId: string) {
    const entity = await this.requireUser(id);
    entity.passwordHash = await argon2.hash(password);
    entity.refreshTokenHash = null;
    entity.updatedBy = actorId;
    await this.users.save(entity);
  }

  private async requireUser(id: string): Promise<UserEntity> {
    const entity = await this.users.findOne({
      where: { id },
      relations: { roles: true },
    });
    if (!entity) {
      throw new BusinessException({
        code: ErrorCode.USER_NOT_FOUND,
        message: 'User was not found',
        status: HttpStatus.NOT_FOUND,
      });
    }
    return entity;
  }

  private async ensureUsernameAvailable(username: string): Promise<void> {
    if (await this.users.findOne({ where: { username }, withDeleted: true })) {
      throw new BusinessException({
        code: ErrorCode.USERNAME_ALREADY_EXISTS,
        message: 'Username already exists',
        status: HttpStatus.CONFLICT,
      });
    }
  }

  private async requireAssignableRoles(ids: string[]): Promise<RoleEntity[]> {
    const roles = await this.roles.findBy({ id: In(ids), isEnabled: true });
    const assignable = roles.filter((role) => role.code !== ROOT_ROLE_CODE);
    const found = new Set(assignable.map((role) => role.id));
    const missingIds = ids.filter((id) => !found.has(id));
    if (missingIds.length) {
      throw new BusinessException({
        code: ErrorCode.ROLES_NOT_FOUND_OR_NOT_ASSIGNABLE,
        message:
          'One or more roles were not found, disabled, or cannot be assigned',
        status: HttpStatus.BAD_REQUEST,
        details: { missingIds },
      });
    }
    return assignable;
  }

  private requireDepartment(deptId: number): void {
    if (!DEPARTMENT_OPTIONS.some((option) => option.value === deptId)) {
      throw new BusinessException({
        code: ErrorCode.DEPARTMENT_NOT_FOUND,
        message: 'Department was not found',
        status: HttpStatus.BAD_REQUEST,
      });
    }
  }

  private assertMatchingId(bodyId: string | undefined, pathId: string): void {
    if (bodyId && bodyId !== pathId) {
      throw new BusinessException({
        code: ErrorCode.RESOURCE_ID_MISMATCH,
        message: 'Body id does not match path id',
        status: HttpStatus.BAD_REQUEST,
      });
    }
  }

  private assertAllUsersFound(ids: string[], entities: UserEntity[]): void {
    const found = new Set(entities.map((entity) => entity.id));
    const missingIds = ids.filter((id) => !found.has(id));
    if (missingIds.length) {
      throw new BusinessException({
        code: ErrorCode.USERS_NOT_FOUND,
        message: 'One or more users were not found',
        status: HttpStatus.NOT_FOUND,
        details: { missingIds },
      });
    }
  }

  private toUserStatus(status: number): UserStatus {
    return status === 1 ? UserStatus.Enabled : UserStatus.Disabled;
  }

  private toResponse(entity: UserEntity): UserItemResponse {
    const visibleRoles = (entity.roles ?? []).filter(
      (role) => role.code !== ROOT_ROLE_CODE,
    );
    return {
      id: entity.id,
      username: entity.username,
      nickname: entity.nickname,
      avatar: entity.avatar,
      gender: entity.gender,
      mobile: entity.mobile,
      email: entity.email,
      deptId: entity.deptId,
      deptName:
        DEPARTMENT_OPTIONS.find((option) => option.value === entity.deptId)
          ?.label ?? '',
      roleIds: visibleRoles.map((role) => role.id),
      roleNames: visibleRoles.map((role) => role.name).join(','),
      status: entity.status === UserStatus.Enabled ? 1 : 0,
      createTime: entity.createdAt.toISOString().slice(0, 19).replace('T', ' '),
    };
  }

  private generatePassword(): string {
    return `${randomBytes(12).toString('base64url')}A1!`;
  }
}
