import { randomBytes } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { BusinessException } from '../common/exceptions/business.exception';
import { RoleEntity } from '../roles/role.entity';
import { AuthenticatedUser } from '../auth/auth.types';
import {
  CreateUserDto,
  UserQueryDto,
  UpdateUserDto,
  IdentityInput,
} from './dto/user-management.dto';
import { UserEntity, UserStatus } from './user.entity';
import { DEPARTMENT_OPTIONS } from './user-management.constants';
import { UserIdentityEntity, LOGIN_SCOPES } from './user-identity.entity';
function denied(message = '没有权限管理该账号'): never {
  throw new BusinessException({
    code: 'AUTH_FORBIDDEN',
    message,
    status: HttpStatus.FORBIDDEN,
  });
}
@Injectable()
export class UserManagementService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    @InjectRepository(RoleEntity)
    private readonly roles: Repository<RoleEntity>,
    private readonly dataSource: DataSource,
  ) {}
  private query(actor: AuthenticatedUser, manager = this.dataSource.manager) {
    const qb = manager
      .createQueryBuilder(UserEntity, 'u')
      .leftJoinAndSelect('u.identities', 'identity')
      .leftJoinAndSelect('identity.roles', 'role')
      .where('u.is_superuser = false');
    if (actor.scope !== 'headquarters')
      qb.andWhere(
        'EXISTS (SELECT 1 FROM user_identities x WHERE x.user_id=u.id AND x.scope=:scope) AND NOT EXISTS (SELECT 1 FROM user_identities x WHERE x.user_id=u.id AND x.scope<>:scope)',
        { scope: actor.scope },
      );
    return qb;
  }
  async getPage(query: UserQueryDto, actor: AuthenticatedUser) {
    const qb = this.query(actor);
    if (query.keyword?.trim())
      qb.andWhere(
        '(u.username ILIKE :keyword OR u.nickname ILIKE :keyword OR u.mobile ILIKE :keyword)',
        { keyword: `%${query.keyword.trim()}%` },
      );
    if (query.status !== undefined)
      qb.andWhere('u.status=:status', {
        status: query.status === 1 ? 'enabled' : 'disabled',
      });
    if (query.deptId)
      qb.andWhere(
        'EXISTS (SELECT 1 FROM user_identities x WHERE x.user_id=u.id AND x.dept_id=:dept)',
        { dept: query.deptId },
      );
    if (query.roleId)
      qb.andWhere(
        'EXISTS (SELECT 1 FROM user_identities x JOIN identity_roles ir ON ir.identity_id=x.id WHERE x.user_id=u.id AND ir.role_id=:roleId)',
        { roleId: query.roleId },
      );
    if (query.createTime?.[0])
      qb.andWhere('u.createdAt::date>=:from', { from: query.createTime[0] });
    if (query.createTime?.[1])
      qb.andWhere('u.createdAt::date<=:to', { to: query.createTime[1] });
    const [rows, total] = await qb
      .orderBy('u.createdAt', 'ASC')
      .addOrderBy('u.id', 'ASC')
      .skip((query.page - 1) * query.pageSize)
      .take(query.pageSize)
      .getManyAndCount();
    return {
      list: rows.map((u) => this.response(u)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }
  private async requireUser(
    id: string,
    actor: AuthenticatedUser,
    manager = this.dataSource.manager,
    lock = false,
  ) {
    if (lock)
      await manager.findOne(UserEntity, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
    const user = await this.query(actor, manager)
      .andWhere('u.id=:id', { id })
      .getOne();
    if (!user)
      throw new BusinessException({
        code: 'USER_NOT_FOUND',
        message: '用户不存在',
        status: HttpStatus.NOT_FOUND,
      });
    return user;
  }
  async getFormData(id: string, actor: AuthenticatedUser) {
    return this.response(await this.requireUser(id, actor));
  }
  async getRoleOptions(actor: AuthenticatedUser) {
    const rows = await this.roles.find({
      where: { isEnabled: true },
      order: { createdAt: 'ASC' },
    });
    return rows
      .filter(
        (r) =>
          [
            'ADMIN',
            'EXECUTIVE',
            'BUSINESS_MANAGER',
            'COORDINATOR',
            'RESOURCE_MANAGER',
          ].includes(r.code) &&
          (actor.scope === 'headquarters' ||
            ['BUSINESS_MANAGER', 'COORDINATOR', 'RESOURCE_MANAGER'].includes(
              r.code,
            )),
      )
      .map((r) => ({
        value: r.id,
        label: r.name,
        code: r.code,
        scopes: ['ADMIN', 'EXECUTIVE'].includes(r.code)
          ? ['headquarters']
          : LOGIN_SCOPES.filter((s) => s !== 'headquarters'),
      }));
  }
  getDepartmentOptions(actor: AuthenticatedUser) {
    return DEPARTMENT_OPTIONS.filter(
      (d) => actor.scope === 'headquarters' || d.scope === actor.scope,
    );
  }
  private async identities(
    input: IdentityInput[],
    actor: AuthenticatedUser,
    manager: EntityManager,
  ) {
    if (new Set(input.map((i) => i.scope)).size !== input.length)
      denied('同一账号每个范围只允许一个身份');
    const result: Array<{ input: IdentityInput; roles: RoleEntity[] }> = [];
    for (const identity of input) {
      if (actor.scope !== 'headquarters' && identity.scope !== actor.scope)
        denied();
      const dept = DEPARTMENT_OPTIONS.find(
        (d) => d.value === identity.deptId && d.scope === identity.scope,
      );
      if (!dept) denied('请选择该登录范围的职能部门');
      const roles = await manager.findBy(RoleEntity, {
        id: In(identity.roleIds),
        isEnabled: true,
      });
      const allowed =
        identity.scope === 'headquarters'
          ? identity.deptId === 1
            ? ['ADMIN']
            : ['EXECUTIVE']
          : ['BUSINESS_MANAGER', 'COORDINATOR', 'RESOURCE_MANAGER'];
      if (
        roles.length !== identity.roleIds.length ||
        roles.some((r) => !allowed.includes(r.code))
      )
        denied('角色不适用于所选身份');
      result.push({ input: identity, roles });
    }
    return result;
  }
  private async countImpact(
    id: string,
    manager: EntityManager,
    scopes?: string[],
  ) {
    const [row] = await manager.query<
      Array<{ total: number; unfinished: number }>
    >(
      `SELECT count(*)::int AS total, count(*) FILTER(WHERE status NOT IN ('lost','archived'))::int AS unfinished FROM inquiries WHERE owner_id=$1${scopes ? ' AND business_unit=ANY($2)' : ''}`,
      scopes ? [id, scopes] : [id],
    );
    return row;
  }
  async inquiryImpact(id: string, actor: AuthenticatedUser) {
    await this.requireUser(id, actor);
    return this.countImpact(id, this.dataSource.manager);
  }
  private async assertNoUnfinished(
    id: string,
    manager: EntityManager,
    scopes?: string[],
  ) {
    const impact = await this.countImpact(id, manager, scopes);
    if (impact.unfinished)
      throw new BusinessException({
        code: 'INQUIRY_OWNER_INVALID',
        message: '请先转交该人员的未完成询盘',
        status: HttpStatus.CONFLICT,
        details: impact,
      });
  }
  async create(input: CreateUserDto, actor: AuthenticatedUser) {
    if (input.username === 'sunrise') denied('该账号名已保留');
    const password =
      input.password ?? `${randomBytes(12).toString('base64url')}A1!`;
    return this.dataSource.transaction(async (manager) => {
      const grants = await this.identities(input.identities, actor, manager);
      const user = await manager.save(
        UserEntity,
        manager.create(UserEntity, {
          username: input.username,
          nickname: input.nickname,
          avatar: input.avatar,
          gender: input.gender,
          mobile: input.mobile,
          email: input.email,
          status: input.status === 1 ? UserStatus.Enabled : UserStatus.Disabled,
          passwordHash: await argon2.hash(password),
          isSuperuser: false,
          createdBy: actor.id,
          updatedBy: actor.id,
        }),
      );
      for (const grant of grants)
        await manager.save(
          UserIdentityEntity,
          manager.create(UserIdentityEntity, {
            userId: user.id,
            username: user.username,
            scope: grant.input.scope,
            deptId: grant.input.deptId,
            roles: grant.roles,
          }),
        );
      return {
        ...(await this.getFormDataWithManager(user.id, actor, manager)),
        ...(input.password ? {} : { temporaryPassword: password }),
      };
    });
  }
  private async getFormDataWithManager(
    id: string,
    actor: AuthenticatedUser,
    manager: EntityManager,
  ) {
    return this.response(await this.requireUser(id, actor, manager));
  }
  async update(id: string, input: UpdateUserDto, actor: AuthenticatedUser) {
    return this.dataSource.transaction(async (manager) => {
      const user = await this.requireUser(id, actor, manager, true);
      if (
        (input.id && input.id !== id) ||
        (input.username && input.username !== user.username)
      )
        denied('账号 ID 和登录名不能变更');
      if (id === actor.id && input.status === 0) denied('不能停用当前账号');
      const grants = await this.identities(input.identities, actor, manager);
      const removedScopes = user.identities
        .filter(
          (old) =>
            old.roles.some((r) =>
              ['COORDINATOR', 'BUSINESS_MANAGER'].includes(r.code),
            ) &&
            !grants.some(
              (next) =>
                next.input.scope === old.scope &&
                next.roles.some((r) =>
                  ['COORDINATOR', 'BUSINESS_MANAGER'].includes(r.code),
                ),
            ),
        )
        .map((i) => i.scope);
      if (input.status === 0) await this.assertNoUnfinished(id, manager);
      else if (removedScopes.length)
        await this.assertNoUnfinished(id, manager, removedScopes);
      Object.assign(user, {
        nickname: input.nickname,
        avatar: input.avatar,
        gender: input.gender,
        mobile: input.mobile,
        email: input.email,
        status: input.status === 1 ? UserStatus.Enabled : UserStatus.Disabled,
        updatedBy: actor.id,
      });
      await manager.save(user);
      for (const old of user.identities)
        if (!grants.some((g) => g.input.scope === old.scope))
          await manager.delete(UserIdentityEntity, old.id);
      for (const grant of grants) {
        const old = user.identities.find((i) => i.scope === grant.input.scope);
        if (grant.input.id && grant.input.id !== old?.id)
          denied('身份 ID 不匹配');
        await manager.save(
          UserIdentityEntity,
          manager.create(UserIdentityEntity, {
            id: old?.id,
            userId: id,
            username: user.username,
            scope: grant.input.scope,
            deptId: grant.input.deptId,
            roles: grant.roles,
            refreshTokenHash: null,
          }),
        );
      }
      return this.getFormDataWithManager(id, actor, manager);
    });
  }
  async delete(ids: string[], actor: AuthenticatedUser) {
    if (ids.includes(actor.id))
      throw new BusinessException({
        code: 'CURRENT_USER_CANNOT_BE_DELETED',
        message: '不能删除当前账号',
        status: HttpStatus.CONFLICT,
      });
    await this.dataSource.transaction(async (manager) => {
      for (const id of [...new Set(ids)].sort()) {
        await this.requireUser(id, actor, manager, true);
        await this.assertNoUnfinished(id, manager);
        await manager.delete(UserIdentityEntity, { userId: id });
        await manager.update(UserEntity, id, { updatedBy: actor.id });
        await manager.softDelete(UserEntity, id);
      }
    });
  }
  async resetPassword(id: string, password: string, actor: AuthenticatedUser) {
    await this.dataSource.transaction(async (manager) => {
      const user = await this.requireUser(id, actor, manager, true);
      user.passwordHash = await argon2.hash(password);
      user.updatedBy = actor.id;
      await manager.save(user);
      await manager.update(
        UserIdentityEntity,
        { userId: id },
        { refreshTokenHash: null },
      );
    });
  }
  private response(user: UserEntity) {
    return {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      avatar: user.avatar,
      gender: user.gender,
      mobile: user.mobile,
      email: user.email,
      status: user.status === UserStatus.Enabled ? 1 : 0,
      createTime: user.createdAt.toISOString(),
      identities: user.identities.map((i) => ({
        id: i.id,
        scope: i.scope,
        deptId: i.deptId,
        deptName:
          DEPARTMENT_OPTIONS.find((d) => d.value === i.deptId)?.label ?? '',
        roleIds: i.roles.map((r) => r.id),
        roleNames: i.roles.map((r) => r.name).join(','),
      })),
    };
  }
}
