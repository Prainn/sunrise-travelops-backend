/** Disposable local PostgreSQL only. Does not load environment files. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { UserManagementService } from '../src/users/user-management.service';
import { UserEntity } from '../src/users/user.entity';
import { RoleEntity } from '../src/roles/role.entity';
import { AuthenticatedUser } from '../src/auth/auth.types';
import { BusinessException } from '../src/common/exceptions/business.exception';
import { CreateUserDto } from '../src/users/dto/user-management.dto';
import { LoginScope } from '../src/users/user-identity.entity';

const db = new DataSource({
  type: 'postgres',
  host: '127.0.0.1',
  port: 55461,
  username: 'postgres',
  password: 'isolated-test-only',
  database: 'user_tour_code_test',
  entities: ['src/**/*.entity.ts'],
  migrations: ['src/migrations/*.ts'],
  synchronize: false,
});
const actor = {
  id: randomUUID(),
  scope: 'headquarters',
  roles: ['ROOT'],
} as AuthenticatedUser;
const isDuplicate = (error: unknown) =>
  error instanceof BusinessException &&
  (error.getResponse() as { code: string }).code === 'USER_TOUR_CODE_EXISTS';

async function main() {
  await db.initialize();
  try {
    await db.runMigrations();
    const service = new UserManagementService(
      db.getRepository(UserEntity),
      db.getRepository(RoleEntity),
      db,
    );
    const coordinator = await db
      .getRepository(RoleEntity)
      .findOneByOrFail({ code: 'COORDINATOR' });
    const admin = await db
      .getRepository(RoleEntity)
      .findOneByOrFail({ code: 'ADMIN' });
    function input(
      username: string,
      code: string | null | undefined,
      scope: LoginScope = 'website',
    ): CreateUserDto {
      return {
        username,
        password: 'TestOnly123!',
        nickname: 'Cathy李明',
        englishName: 'Cathy',
        tourCode: code,
        avatar: '',
        gender: 0,
        mobile: '',
        email: '',
        status: 1,
        identities: [
          {
            scope,
            deptId: scope === 'headquarters' ? 1 : scope === 'website' ? 7 : 3,
            roleIds: [scope === 'headquarters' ? admin.id : coordinator.id],
          },
        ],
      };
    }
    const first = await service.create(input('first', ' cl '), actor);
    assert.equal(first.tourCode, 'CL');
    await assert.rejects(
      service.create(input('other_scope', 'cl', 'shengxu'), actor),
      isDuplicate,
    );
    assert.equal(
      await db.getRepository(UserEntity).countBy({ username: 'other_scope' }),
      0,
    );
    const edit = input('first', 'CL');
    await service.update(first.id, edit, actor);
    const second = await service.create(input('second', 'AL'), actor);
    await assert.rejects(
      service.update(
        second.id,
        { ...input('second', 'CL'), nickname: 'Should not persist' },
        actor,
      ),
      isDuplicate,
    );
    assert.equal(
      (await service.getFormData(second.id, actor)).nickname,
      'Cathy李明',
    );

    const concurrent = await Promise.allSettled([
      service.create(input('race_one', 'RZ'), actor),
      service.create(input('race_two', 'rz', 'shengxu'), actor),
    ]);
    assert.equal(concurrent.filter((r) => r.status === 'fulfilled').length, 1);
    const rejected = concurrent.find((r) => r.status === 'rejected');
    assert(rejected?.status === 'rejected' && isDuplicate(rejected.reason));
    const editRace = await Promise.allSettled([
      service.update(first.id, input('first', 'NZ'), actor),
      service.update(second.id, input('second', 'NZ'), actor),
    ]);
    assert.equal(editRace.filter((r) => r.status === 'fulfilled').length, 1);
    assert(
      editRace.some((r) => r.status === 'rejected' && isDuplicate(r.reason)),
    );

    const az = await service.create(input('az_user', 'AZ', 'shengxu'), actor);
    for (const [englishName, nickname, tourCode] of [
      ['Andrew', 'Andrew朱相龙', 'ANZ'],
      ['Arthur', 'Arthur郑赫', 'ARZ'],
      ['Allen', 'Allen张奥岚', 'ALZ'],
    ])
      assert.deepEqual(
        await service.suggestTourCode({ englishName, nickname }),
        { tourCode },
      );
    await service.create({ ...input('anz_user', 'ANZ'), status: 0 }, actor);
    assert.deepEqual(
      await service.suggestTourCode({
        englishName: 'Andrew',
        nickname: '朱相龙',
      }),
      { tourCode: 'ANDZ' },
    );
    assert.deepEqual(
      await service.suggestTourCode({ englishName: 'A', nickname: '朱相龙' }),
      { tourCode: null },
    );
    await service.delete([az.id], actor);
    assert.deepEqual(
      await service.suggestTourCode({
        englishName: 'Andrew',
        nickname: '朱相龙',
      }),
      { tourCode: 'AZ' },
    );
    await service.create(input('az_reused', 'AZ'), actor);

    const hq = await service.create(
      input('hq_empty', undefined, 'headquarters'),
      actor,
    );
    assert.equal(hq.tourCode, null);
    await service.update(hq.id, input('hq_empty', null, 'headquarters'), actor);
    const hqOld = await service.create(
      input('hq_old', 'HQ', 'headquarters'),
      actor,
    );
    await service.update(
      hqOld.id,
      input('hq_old', undefined, 'headquarters'),
      actor,
    );
    assert.equal((await service.getFormData(hqOld.id, actor)).tourCode, 'HQ');
    await assert.rejects(
      service.create(input('hq_duplicate', 'HQ', 'headquarters'), actor),
      isDuplicate,
    );
    console.log(
      'PASS: create/update uniqueness, concurrency, self exclusion, cross-scope/disabled/deleted occupancy, suggestions, headquarters optional/preservation.',
    );
  } finally {
    await db.destroy();
  }
}
void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
