import { RESERVED_USERNAMES } from '../auth/account-access';
import {
  availableTourCode,
  linkError,
  lockAccountLinks,
} from './account-links.rules';
import {
  assignmentInvalid,
  CoordinatorDuty,
  requireBusinessGroup,
} from './coordinator-assignment';
import { assertBusinessGroupAccess } from './business-groups.service';
import {
  UpdateCoordinatorDutyDto,
  UpdateUserBusinessGroupDto,
} from './dto/business-group.dto';
import { FeishuService } from '../feishu/feishu.service';
import {
  LedgerReminderKind,
  simulatedLedgerReminder,
} from '../feishu/ledger-reminder';
import { randomUUID } from 'node:crypto';
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
  TourCodeSuggestionQueryDto,
} from './dto/user-management.dto';
import { UserEntity, UserStatus } from './user.entity';
import { DEPARTMENT_OPTIONS } from './user-management.constants';
import { UserIdentityEntity, LOGIN_SCOPES } from './user-identity.entity';
import { tourCodeCandidates } from './tour-code';
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
    private readonly feishu: FeishuService,
  ) {}
  private query(actor: AuthenticatedUser, manager = this.dataSource.manager) {
    const qb = manager
      .createQueryBuilder(UserEntity, 'u')
      .leftJoinAndSelect('u.identities', 'identity')
      .leftJoinAndSelect('identity.roles', 'role')
      .leftJoinAndSelect('identity.businessGroup', 'businessGroup')
      .where('u.is_superuser = false')
      .andWhere('u.username NOT IN (:...reservedUsernames)', {
        reservedUsernames: RESERVED_USERNAMES,
      });
    if (actor.scope !== 'headquarters')
      qb.andWhere(
        'EXISTS (SELECT 1 FROM user_identities x WHERE x.user_id=u.id AND x.scope=:scope) AND NOT EXISTS (SELECT 1 FROM user_identities x WHERE x.user_id=u.id AND x.scope<>:scope)',
        { scope: actor.scope },
      );
    return qb;
  }
  async getPage(query: UserQueryDto, actor: AuthenticatedUser) {
    const qb = this.query(actor);
    const identityFilters: string[] = [];
    const identityParams: Record<string, string> = {};
    if (query.scope) {
      if (actor.scope !== 'headquarters' && query.scope !== actor.scope)
        denied();
      identityFilters.push('x.scope=:selectedScope');
      identityParams.selectedScope = query.scope;
    }
    if (query.businessGroupId) {
      if (!['headquarters', 'linxi'].includes(actor.scope)) denied();
      identityFilters.push('x.business_group_id=:groupId');
      identityParams.groupId = query.businessGroupId;
    }
    if (query.coordinatorDuty) {
      identityFilters.push('x.coordinator_duty=:duty');
      identityParams.duty = query.coordinatorDuty;
    }
    if (identityFilters.length)
      qb.andWhere(
        `EXISTS (SELECT 1 FROM user_identities x WHERE x.user_id=u.id AND ${identityFilters.join(' AND ')})`,
        identityParams,
      );
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
  async suggestTourCode(input: TourCodeSuggestionQueryDto) {
    const candidates = tourCodeCandidates(input.englishName, input.nickname);
    if (!candidates.length) return { tourCode: null };
    // Only candidate occupancy is read across scopes; no account data is returned.
    const rows = await this.dataSource.manager.query<{ code: string }[]>(
      `SELECT DISTINCT upper(btrim(tour_code)) AS code FROM users
       WHERE deleted_at IS NULL AND upper(btrim(tour_code)) = ANY($1::text[])`,
      [candidates],
    );
    const used = new Set(rows.map((row) => row.code));
    return { tourCode: candidates.find((code) => !used.has(code)) ?? null };
  }

  private async resolveTourCode(
    manager: EntityManager,
    input: CreateUserDto | UpdateUserDto,
    user?: UserEntity,
  ) {
    if (!input.tourCode?.trim()) {
      if (
        input.identities.length === 1 &&
        input.identities[0].scope === 'headquarters'
      )
        return user?.tourCode ?? null;
      throw new BusinessException({
        code: 'VALIDATION_ERROR',
        message: '业务账号必须填写团号标识',
        status: HttpStatus.BAD_REQUEST,
      });
    }
    return this.requireAvailableTourCode(manager, input.tourCode, user?.id);
  }

  private async requireAvailableTourCode(
    manager: EntityManager,
    value: string,
    excludeId: string | null = null,
  ) {
    return availableTourCode(manager, value, excludeId);
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
  async testFeishu(
    id: string,
    template: LedgerReminderKind,
    actor: AuthenticatedUser,
  ) {
    if (!actor.permissions.includes('sys:user:update')) denied();
    const user = await this.requireUser(id, actor);
    if (user.status !== UserStatus.Enabled || !user.feishuOpenId)
      assignmentInvalid('请选择已启用且已接入飞书的账号');
    return this.feishu.sendText(
      user.feishuOpenId,
      simulatedLedgerReminder(template),
      randomUUID(),
    );
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
    if (input.length !== 1)
      throw new BusinessException({
        code: 'VALIDATION_ERROR',
        message: '一个账号只能有一个登录范围和部门',
        status: HttpStatus.BAD_REQUEST,
      });
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
  private async assignment(
    manager: EntityManager,
    input: IdentityInput,
    roles: RoleEntity[],
    existing?: UserIdentityEntity,
  ) {
    const coordinator = roles.some((role) => role.code === 'COORDINATOR');
    if (input.scope === 'shengxu' && input.coordinatorDuty != null)
      assignmentInvalid('盛旭账号不设置计调分工');
    if (!coordinator && input.coordinatorDuty != null)
      assignmentInvalid('只有计调账号可以设置计调分工');
    let coordinatorDuty: CoordinatorDuty | null = null;
    if (coordinator)
      coordinatorDuty =
        input.scope === 'shengxu'
          ? (existing?.coordinatorDuty ?? null)
          : (input.coordinatorDuty ?? existing?.coordinatorDuty ?? 'reception');
    const businessGroupId = input.businessGroupId ?? null;
    if (input.scope === 'linxi') {
      if (!businessGroupId) assignmentInvalid('请选择霖熹账号所属业务组');
      if (businessGroupId !== existing?.businessGroupId)
        await requireBusinessGroup(manager, businessGroupId);
    } else if (businessGroupId) assignmentInvalid('只有霖熹账号可以设置业务组');
    return { coordinatorDuty, businessGroupId };
  }

  private assertUserVersion(user: UserEntity, version: number) {
    if (user.version !== version)
      throw new BusinessException({
        code: 'CONFLICT',
        message: '用户已更新，请刷新后重试',
        status: HttpStatus.CONFLICT,
        details: { currentVersion: user.version },
      });
  }

  async updateCoordinatorDuty(
    id: string,
    input: UpdateCoordinatorDutyDto,
    actor: AuthenticatedUser,
  ) {
    if (!actor.permissions.includes('sys:user:update')) denied();
    return this.dataSource.transaction(async (manager) => {
      await lockAccountLinks(manager);
      const user = await this.requireUser(id, actor, manager, true);
      this.assertUserVersion(user, input.version);
      if (user.identities.length !== 1)
        assignmentInvalid('请先明确账号的唯一登录范围');
      const identity = user.identities[0];
      if (identity.scope === 'shengxu')
        assignmentInvalid('盛旭账号不设置计调分工');
      if (
        !identity.roles.some(
          (role) => role.code === 'COORDINATOR' && role.isEnabled,
        )
      )
        assignmentInvalid('只有计调账号可以设置计调分工');
      await manager.update(UserIdentityEntity, identity.id, {
        coordinatorDuty: input.coordinatorDuty,
      });
      await manager.update(UserEntity, id, { updatedBy: actor.id });
      return this.getFormDataWithManager(id, actor, manager);
    });
  }

  async updateBusinessGroup(
    id: string,
    input: UpdateUserBusinessGroupDto,
    actor: AuthenticatedUser,
  ) {
    assertBusinessGroupAccess(actor, 'update');
    return this.dataSource.transaction(async (manager) => {
      await lockAccountLinks(manager);
      const user = await this.requireUser(id, actor, manager, true);
      this.assertUserVersion(user, input.version);
      if (user.identities.length !== 1 || user.identities[0].scope !== 'linxi')
        assignmentInvalid('只有单一霖熹身份的账号可以设置业务组');
      const identity = user.identities[0];
      if (identity.businessGroupId !== input.businessGroupId)
        await requireBusinessGroup(manager, input.businessGroupId);
      await manager.update(UserIdentityEntity, identity.id, {
        businessGroupId: input.businessGroupId,
      });
      await manager.update(UserEntity, id, { updatedBy: actor.id });
      return this.getFormDataWithManager(id, actor, manager);
    });
  }

  private async countImpact(
    id: string,
    manager: EntityManager,
    scopes?: string[],
  ) {
    const [row] = await manager.query<
      Array<{ total: number; unfinished: number }>
    >(
      `SELECT count(*)::int AS total,
        count(*) FILTER(WHERE status NOT IN ('lost','archived'))::int AS unfinished
       FROM (
         SELECT status FROM inquiries WHERE owner_id=$1 AND deleted_at IS NULL${scopes ? ' AND business_unit=ANY($2)' : ''}
         UNION ALL
         SELECT status FROM website_inquiries WHERE owner_id=$1 AND deleted_at IS NULL${scopes ? ' AND business_unit=ANY($2)' : ''}
       ) owned_inquiries`,
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
    if (RESERVED_USERNAMES.includes(input.username)) denied('该账号名已保留');
    const password =
      input.password ?? `${randomBytes(12).toString('base64url')}A1!`;
    return this.dataSource.transaction(async (manager) => {
      await lockAccountLinks(manager);
      const grants = await this.identities(input.identities, actor, manager);
      const tourCode = await this.resolveTourCode(manager, input);
      const user = await manager.save(
        UserEntity,
        manager.create(UserEntity, {
          username: input.username,
          nickname: input.nickname,
          englishName: input.englishName,
          tourCode,
          avatar: input.avatar,
          gender: input.gender,
          mobile: input.mobile,
          email: input.email,
          feishuOpenId: input.feishuOpenId ?? '',
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
            ...(await this.assignment(manager, grant.input, grant.roles)),
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
      await lockAccountLinks(manager);
      const user = await this.requireUser(id, actor, manager, true);
      if (id === actor.id && input.status === 0) denied('不能停用当前账号');
      if (
        user.accountLinkId &&
        (input.identities.length !== 1 ||
          input.identities[0].scope !== user.identities[0]?.scope)
      )
        linkError(
          '请先调整或解除账号关联，再修改业务范围',
          'CONFLICT',
          HttpStatus.CONFLICT,
        );
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
      const tourCode = await this.resolveTourCode(manager, input, user);
      Object.assign(user, {
        nickname: input.nickname,
        englishName: input.englishName,
        tourCode,
        avatar: input.avatar,
        gender: input.gender,
        mobile: input.mobile,
        email: input.email,
        feishuOpenId: input.feishuOpenId ?? user.feishuOpenId,
        status: input.status === 1 ? UserStatus.Enabled : UserStatus.Disabled,
        updatedBy: actor.id,
      });
      await manager.save(user);
      await manager.query(
        'DELETE FROM auth_account_sessions WHERE user_id=$1',
        [id],
      );
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
            ...(await this.assignment(manager, grant.input, grant.roles, old)),
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
      await lockAccountLinks(manager);
      for (const id of [...new Set(ids)].sort()) {
        const user = await this.requireUser(id, actor, manager, true);
        if (
          actor.scope !== 'headquarters' &&
          actor.roles.includes('BUSINESS_MANAGER') &&
          user.identities.some(
            (identity) =>
              identity.scope === actor.scope &&
              identity.roles.some((role) => role.code === 'BUSINESS_MANAGER'),
          )
        )
          denied('业务负责人不能删除其他业务负责人');
        if (user.accountLinkId)
          linkError(
            '请先解除账号关联，再删除账号',
            'CONFLICT',
            HttpStatus.CONFLICT,
          );
        await this.assertNoUnfinished(id, manager);
        await manager.delete(UserIdentityEntity, { userId: id });
        await manager.update(UserEntity, id, { updatedBy: actor.id });
        await manager.softDelete(UserEntity, id);
      }
    });
  }
  async resetPassword(id: string, password: string, actor: AuthenticatedUser) {
    await this.dataSource.transaction(async (manager) => {
      await lockAccountLinks(manager);
      const user = await this.requireUser(id, actor, manager, true);
      await manager.query(
        'DELETE FROM auth_account_sessions WHERE user_id=$1',
        [id],
      );
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
      version: user.version,
      username: user.username,
      nickname: user.nickname,
      englishName: user.englishName,
      tourCode: user.tourCode,
      avatar: user.avatar,
      gender: user.gender,
      mobile: user.mobile,
      email: user.email,
      feishuOpenId: user.feishuOpenId,
      status: user.status === UserStatus.Enabled ? 1 : 0,
      createTime: user.createdAt.toISOString(),
      identities: user.identities.map((i) => {
        const roles = [...i.roles].sort(
          (a, b) => a.code.localeCompare(b.code) || a.id.localeCompare(b.id),
        );
        return {
          id: i.id,
          scope: i.scope,
          deptId: i.deptId,
          coordinatorDuty: i.coordinatorDuty,
          businessGroupId: i.businessGroupId,
          businessGroupName: i.businessGroup?.name ?? null,
          businessGroupStatus: i.businessGroup?.status ?? null,
          deptName:
            DEPARTMENT_OPTIONS.find((d) => d.value === i.deptId)?.label ?? '',
          roleIds: roles.map((r) => r.id),
          roleNames: roles.map((r) => r.name).join(','),
        };
      }),
    };
  }
}
