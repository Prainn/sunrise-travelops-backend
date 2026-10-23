import { BusinessException } from '../common/exceptions/business.exception';
import { HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, In } from 'typeorm';
import { AuthenticatedUser } from '../auth/auth.types';
import { OperationLogEntity } from '../operation-logs/operation-log.entity';
import { UserEntity, UserStatus } from './user.entity';
import { SCOPE_NAMES, UserIdentityEntity } from './user-identity.entity';
import {
  AccountLinkCandidateQueryDto,
  AccountLinkQueryDto,
  CreateAccountLinkDto,
  DeleteAccountLinkDto,
  UpdateAccountLinkDto,
} from './dto/account-link.dto';
import {
  assertLinkAdmin,
  availableTourCode,
  linkError,
  lockAccountLinks,
} from './account-links.rules';

@Injectable()
export class AccountLinksService {
  constructor(private readonly db: DataSource) {}

  private valid(user: UserEntity, requireEnabled = false) {
    const identity = user.identities[0];
    return (
      !user.deletedAt &&
      !user.isSuperuser &&
      user.username !== 'sunrise' &&
      user.identities.length === 1 &&
      ['shengxu', 'linxi', 'website'].includes(identity.scope) &&
      (!requireEnabled ||
        (user.status === UserStatus.Enabled &&
          identity.roles.some(
            (r) =>
              r.isEnabled &&
              ['BUSINESS_MANAGER', 'COORDINATOR', 'RESOURCE_MANAGER'].includes(
                r.code,
              ),
          )))
    );
  }

  present(user: UserEntity, currentId?: string) {
    const identity = user.identities[0];
    return {
      userId: user.id,
      identityId: identity.id,
      username: identity.username,
      nickname: user.nickname,
      scope: identity.scope,
      scopeName: SCOPE_NAMES[identity.scope],
      status: user.status,
      tourCode: user.tourCode,
      current: user.id === currentId,
    };
  }

  async members(manager: EntityManager, id: string) {
    return manager.find(UserEntity, {
      where: { accountLinkId: id },
      relations: { identities: { roles: true } },
      order: { id: 'ASC' },
    });
  }

  async list(query: AccountLinkQueryDto, actor: AuthenticatedUser) {
    assertLinkAdmin(actor);
    const keyword = `%${query.keyword?.trim() ?? ''}%`;
    const filter = `EXISTS(SELECT 1 FROM users u JOIN user_identities i ON i.user_id=u.id WHERE u.account_link_id=g.id AND u.deleted_at IS NULL AND (u.nickname ILIKE $1 OR i.username ILIKE $1 OR u.tour_code ILIKE $1))`;
    const [total] = await this.db.query<{ count: number }[]>(
      `SELECT count(*)::int AS count FROM account_link_groups g WHERE ${filter}`,
      [keyword],
    );
    const groups = await this.db.query<{ id: string; version: number }[]>(
      `SELECT g.id,g.version FROM account_link_groups g WHERE ${filter} ORDER BY g.created_at DESC,g.id LIMIT $2 OFFSET $3`,
      [keyword, query.pageSize, (query.page - 1) * query.pageSize],
    );
    const list = [];
    for (const group of groups)
      list.push({
        ...group,
        members: (await this.members(this.db.manager, group.id)).map((u) =>
          this.present(u),
        ),
      });
    return {
      list,
      total: total.count,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async candidates(
    query: AccountLinkCandidateQueryDto,
    actor: AuthenticatedUser,
  ) {
    assertLinkAdmin(actor);
    const qb = this.db
      .getRepository(UserEntity)
      .createQueryBuilder('u')
      .leftJoinAndSelect('u.identities', 'i')
      .leftJoinAndSelect('i.roles', 'r')
      .where('u.is_superuser=false AND u.username<>:reserved', {
        reserved: 'sunrise',
      })
      .andWhere('(u.account_link_id IS NULL OR u.account_link_id=:group)', {
        group: query.groupId ?? null,
      })
      .andWhere(
        "(SELECT count(*) FROM user_identities x WHERE x.user_id=u.id)=1 AND i.scope IN ('shengxu','linxi','website')",
      )
      .andWhere(
        '(u.nickname ILIKE :keyword OR i.username ILIKE :keyword OR u.tour_code ILIKE :keyword)',
        { keyword: `%${query.keyword?.trim() ?? ''}%` },
      )
      .orderBy('i.scope', 'ASC')
      .addOrderBy('u.id', 'ASC')
      .skip((query.page - 1) * query.pageSize)
      .take(query.pageSize);
    if (query.scope) qb.andWhere('i.scope = :scope', { scope: query.scope });
    const [users, total] = await qb.getManyAndCount();
    return {
      list: users.map((u) => this.present(u)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async get(id: string, actor: AuthenticatedUser, manager = this.db.manager) {
    assertLinkAdmin(actor);
    const [group] = await manager.query<{ id: string; version: number }[]>(
      'SELECT id,version FROM account_link_groups WHERE id=$1',
      [id],
    );
    if (!group) linkError('关联组不存在', 'NOT_FOUND', HttpStatus.NOT_FOUND);
    return {
      ...group,
      members: (await this.members(manager, id)).map((u) => this.present(u)),
    };
  }

  async switchTargets(actor: AuthenticatedUser) {
    const user = await this.db.manager.findOne(UserEntity, {
      where: { id: actor.id },
      relations: { identities: { roles: true } },
    });
    if (!user?.accountLinkId || !this.valid(user, true)) return [];
    const users = await this.members(this.db.manager, user.accountLinkId);
    return users
      .filter((u) => this.valid(u, true))
      .map((u) => this.present(u, actor.id));
  }

  async requireTarget(
    manager: EntityManager,
    actor: AuthenticatedUser,
    targetId: string,
  ): Promise<UserIdentityEntity> {
    const source = await manager.findOne(UserEntity, {
      where: { id: actor.id },
      relations: { identities: { roles: true } },
    });
    const target = await manager.findOne(UserEntity, {
      where: { id: targetId },
      relations: { identities: { roles: true } },
    });
    if (
      !source ||
      !target ||
      source.id === target.id ||
      !source.accountLinkId ||
      source.accountLinkId !== target.accountLinkId ||
      !this.valid(source, true) ||
      !this.valid(target, true) ||
      source.identities[0].id !== actor.identityId ||
      source.identities[0].scope !== actor.scope
    )
      linkError(
        '关联账号不可切换，请刷新后重试',
        'AUTH_FORBIDDEN',
        HttpStatus.FORBIDDEN,
      );
    const identity = target.identities[0];
    identity.user = target;
    return identity;
  }

  async save(
    input: CreateAccountLinkDto | UpdateAccountLinkDto | DeleteAccountLinkDto,
    actor: AuthenticatedUser,
    ip: string,
    id?: string,
    remove = false,
  ) {
    assertLinkAdmin(actor);
    return this.db.transaction(async (manager) => {
      await lockAccountLinks(manager);
      const before = id ? await this.get(id, actor, manager) : null;
      if (before && (!('version' in input) || input.version !== before.version))
        throw new BusinessException({
          code: 'CONFLICT',
          message: '关联组已更新，请刷新后重试',
          status: HttpStatus.CONFLICT,
          details: { currentVersion: before.version },
        });
      const selected = 'userIds' in input ? input.userIds : [];
      const ids = [
        ...new Set([
          ...(before?.members.map((u) => u.userId) ?? []),
          ...selected,
        ]),
      ].sort();
      const users = await manager.find(UserEntity, {
        where: { id: In(ids) },
        relations: { identities: { roles: true } },
      });
      if (users.length !== ids.length) linkError('账号不存在或已删除');
      const next = users.filter((u) => selected.includes(u.id));
      if (
        !remove &&
        (next.length < 2 ||
          next.length > 3 ||
          next.some((u) => !this.valid(u)) ||
          new Set(next.map((u) => u.identities[0].scope)).size !== next.length)
      )
        linkError('每组须为2–3个唯一业务的独立账号，不能包含总部账号');
      if (next.some((u) => u.accountLinkId && u.accountLinkId !== id))
        linkError('账号已属于其他关联组', 'CONFLICT', HttpStatus.CONFLICT);
      if (
        'tourCodeMode' in input &&
        input.tourCodeMode === 'keep' &&
        input.tourCode !== undefined
      )
        linkError('保留标识时不要提交统一标识');
      if (
        'tourCodeMode' in input &&
        input.tourCodeMode === 'unify' &&
        input.tourCodes?.some((c) => selected.includes(c.userId))
      )
        linkError('统一标识不能同时覆盖组内单独标识');
      const groupId = id ?? randomUUID();
      if (!id)
        await manager.query(
          'INSERT INTO account_link_groups(id,created_by,updated_by) VALUES($1,$2,$2)',
          [groupId, actor.id],
        );
      if (id)
        await manager.query(
          'UPDATE users SET account_link_id=NULL,version=version+1,updated_by=$2,updated_at=now() WHERE account_link_id=$1',
          [id, actor.id],
        );
      if (!remove)
        await manager.query(
          'UPDATE users SET account_link_id=$1,version=version+1,updated_by=$3,updated_at=now() WHERE id=ANY($2::uuid[])',
          [groupId, selected, actor.id],
        );
      const codes = [...(input.tourCodes ?? [])];
      if ('tourCodeMode' in input && input.tourCodeMode === 'unify') {
        if (!input.tourCode) linkError('请填写统一团号标识');
        codes.push(
          ...selected.map((userId) => ({ userId, tourCode: input.tourCode! })),
        );
      }
      if (codes.some((c) => !ids.includes(c.userId)))
        linkError('只能修改本次受影响账号的标识');
      for (const c of codes) {
        if (!/^[A-Z0-9]{1,10}$/.test(c.tourCode)) linkError('团号标识格式无效');
        await manager.update(UserEntity, c.userId, {
          tourCode: c.tourCode,
          updatedBy: actor.id,
        });
      }
      // Validate final partition and codes after every assignment, so code swaps are atomic too.
      const finalUsers = await manager.findBy(UserEntity, { id: In(ids) });
      for (const user of finalUsers)
        if (user.tourCode)
          await availableTourCode(manager, user.tourCode, user.id);
      if (remove)
        await manager.query('DELETE FROM account_link_groups WHERE id=$1', [
          id,
        ]);
      else if (id)
        await manager.query(
          'UPDATE account_link_groups SET version=version+1,updated_by=$2,updated_at=now() WHERE id=$1',
          [id, actor.id],
        );
      const after = remove ? null : await this.get(groupId, actor, manager);
      await manager.insert(OperationLogEntity, {
        category: 'user',
        action: remove ? '解除账号关联' : id ? '调整账号关联' : '建立账号关联',
        success: true,
        actorId: actor.id,
        actorName: actor.username,
        scope: actor.scope,
        ip: ip.slice(0, 64),
        detail: JSON.stringify({ groupId, before, after, tourCodes: codes }),
      });
      return after;
    });
  }
}
