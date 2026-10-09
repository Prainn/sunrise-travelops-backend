/** Only connects to the disposable PostgreSQL container on localhost:55439. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { DataSource } from 'typeorm';
import { validate } from 'class-validator';
import { AgenciesService } from '../src/resources/agencies/agencies.service';
import {
  AgencyEntity,
  AgencyContactEntity,
} from '../src/resources/agencies/agency.entity';
import {
  CreateAgencyDto,
  AgencyDetailResponse,
} from '../src/resources/agencies/dto/agency.dto';
import { ResourceValidationService } from '../src/resources/common/resource-validation.service';
import { ResourceStatus } from '../src/resources/common/resource.constants';
import { withResourceScope } from '../src/resources/common/resource-scope';
import { SelectionService } from '../src/resources/selections/selection.service';
import { UserEntity } from '../src/users/user.entity';
import {
  UserIdentityEntity,
  ResourceLibrary,
} from '../src/users/user-identity.entity';
import { RoleEntity } from '../src/roles/role.entity';
import { AuthenticatedUser } from '../src/auth/auth.types';
import { CityEntity } from '../src/resources/cities/city.entity';
import { BusinessDictionaryTypeEntity } from '../src/system/business-dictionaries/business-dictionary-type.entity';
import { BusinessDictionaryItemEntity } from '../src/system/business-dictionaries/business-dictionary-item.entity';

const connection = {
  type: 'postgres' as const,
  host: '127.0.0.1',
  port: 55439,
  username: 'postgres',
  password: 'isolated-test-only',
};
const migrationName = 'AddAgencyHierarchy1791365557000';
const databases = ['agency_hierarchy_empty', 'agency_hierarchy_old'];
const admin = new DataSource({ ...connection, database: 'postgres' });
let db: DataSource | undefined;
let countryId = '';

function source(database: string) {
  return new DataSource({
    ...connection,
    database,
    synchronize: false,
    entities: ['src/**/*.entity.ts'],
    migrations: ['src/migrations/*.ts'],
  });
}

function input(
  name: string,
  coordinatorId: string,
  parentId: string | null = null,
): CreateAgencyDto {
  return {
    name,
    parentId,
    coordinatorId,
    businessUnit: 'shengxu',
    city: '',
    countryItemId: countryId,
    email: '',
    remark: '',
    status: ResourceStatus.Enabled,
  };
}

async function run() {
  await admin.initialize();
  try {
    for (const database of databases)
      await admin.query(`CREATE DATABASE "${database}"`);
    db = await source(databases[0]).initialize();
    assert.equal((await db.runMigrations()).length, 53);
    assert.equal((await db.runMigrations()).length, 0);
    await db.destroy();
    db = await source(databases[1]).initialize();
    const [hierarchyMigration] = db.migrations.splice(
      db.migrations.findIndex((migration) => migration.name === migrationName),
      1,
    );
    assert.equal((await db.runMigrations()).length, 52);
    const [legacy] = await db.query<{ id: string }[]>(
      `INSERT INTO resource_agencies (code,name,library,business_unit)
       VALUES ('AGY-900','既有组团社','shengxu','shengxu') RETURNING id`,
    );
    db.migrations.push(hierarchyMigration);
    assert.equal((await db.runMigrations()).length, 1);
    assert.equal((await db.runMigrations()).length, 0);
    const retained = await db
      .getRepository(AgencyEntity)
      .findOneByOrFail({ id: legacy.id });
    assert.equal(retained.parentId, null);
    assert.equal(retained.code, 'AGY-900');
    assert.equal(retained.name, '既有组团社');

    const [country] = await db.query<{ id: string }[]>(
      `INSERT INTO system_business_dictionary_items (type_id, code, name, english_name)
       SELECT id, 'CHN', '中国', 'People''s Republic of China' FROM system_business_dictionary_types
       WHERE code = 'country-region' RETURNING id`,
    );
    countryId = country.id;

    const roles = db.getRepository(RoleEntity);
    await roles.upsert({ code: 'COORDINATOR', name: '计调', isEnabled: true }, [
      'code',
    ]);
    const role = await roles.findOneByOrFail({ code: 'COORDINATOR' });
    const userRepository = db.getRepository(UserEntity);
    const owner = await userRepository.save(
      userRepository.create({
        username: 'hierarchy-owner',
        nickname: '计调一',
        englishName: 'hierarchy-owner',
        passwordHash: 'unused',
      }),
    );
    const otherOwner = await userRepository.save(
      userRepository.create({
        username: 'hierarchy-other-owner',
        nickname: '计调二',
        englishName: 'hierarchy-other-owner',
        passwordHash: 'unused',
      }),
    );
    const identities = db.getRepository(UserIdentityEntity);
    for (const scope of ['shengxu', 'linxi', 'website'] as const)
      await identities.save(
        identities.create({
          userId: owner.id,
          username: owner.username,
          scope,
          deptId: null,
          roles: [role],
        }),
      );
    await identities.save(
      identities.create({
        userId: otherOwner.id,
        username: otherOwner.username,
        scope: 'shengxu',
        deptId: null,
        roles: [role],
      }),
    );
    const actor: AuthenticatedUser = {
      id: owner.id,
      username: owner.username,
      nickname: owner.nickname,
      identityId: '',
      scope: 'headquarters',
      scopeName: '总部',
      deptId: null,
      deptName: '',
      roles: ['ROOT'],
      permissions: [],
      resourceLibrary: null,
    };
    const agencyRepository = db.getRepository(AgencyEntity);
    const contactRepository = db.getRepository(AgencyContactEntity);
    const service = new AgenciesService(
      agencyRepository,
      contactRepository,
      db,
      new ResourceValidationService(
        db.getRepository(BusinessDictionaryTypeEntity),
        db.getRepository(BusinessDictionaryItemEntity),
        db.getRepository(CityEntity),
      ),
    );
    const selections = new SelectionService(db);
    const scoped = <T>(action: () => T, library: ResourceLibrary = 'shengxu') =>
      withResourceScope(actor, library, action);
    const update = (agency: AgencyDetailResponse, name = agency.shortName) =>
      scoped(() =>
        service.update(
          agency.id,
          {
            ...input(name, agency.coordinatorId!, agency.parentId),
            version: agency.version,
          },
          actor,
        ),
      );
    let parent = await scoped(() =>
      service.create(input('北京天马', owner.id), actor),
    );
    const parentContact = await scoped(() =>
      service.createContact(
        parent.id,
        { name: '联系人', phone: '100' },
        owner.id,
      ),
    );
    let child = await scoped(() =>
      service.create(
        input('HAHNEMANN TRAVEL', otherOwner.id, parent.id),
        actor,
      ),
    );
    assert.equal(child.name, '北京天马-HAHNEMANN TRAVEL');
    assert.equal(child.shortName, 'HAHNEMANN TRAVEL');
    assert.equal(child.parentName, '北京天马');
    assert.equal(child.coordinatorId, otherOwner.id);
    assert.deepEqual(child.contacts, []);
    const childContact = await scoped(() =>
      service.createContact(
        child.id,
        { name: '联系人', phone: '200' },
        owner.id,
      ),
    );
    await scoped(() =>
      service.updateContact(
        parent.id,
        parentContact.id,
        { name: '联系人', phone: '300', version: parentContact.version },
        owner.id,
      ),
    );
    assert.equal(
      (await scoped(() => service.listContacts(child.id)))[0].phone,
      childContact.phone,
    );
    const listed = await scoped(() =>
      service.list({ page: 1, pageSize: 50, keyword: 'HAHNEMANN' }),
    );
    assert.equal(listed.list[0].shortName, child.shortName);
    assert.equal(listed.list[0].contactCount, 1);
    const both = await scoped(() =>
      selections.resources('agencies', {
        page: 1,
        pageSize: 50,
        keyword: '北京天马',
      }),
    );
    assert.equal(both.total, 2);
    const parents = await scoped(() =>
      selections.resources('agencies', {
        page: 1,
        pageSize: 50,
        parentOnly: 'true',
        excludeId: retained.id,
        businessUnit: 'shengxu',
      }),
    );
    assert.deepEqual(
      parents.list.map((entry) => entry.id),
      [parent.id],
    );
    await assert.rejects(
      scoped(() => service.create(input('三级', owner.id, child.id), actor)),
      /一级/,
    );
    await assert.rejects(
      scoped(() =>
        service.update(
          parent.id,
          {
            ...input('北京天马', owner.id, parent.id),
            version: parent.version,
          },
          actor,
        ),
      ),
      /当前组团社/,
    );
    await assert.rejects(
      scoped(() =>
        service.update(
          parent.id,
          {
            ...input('北京天马', owner.id, retained.id),
            version: parent.version,
          },
          actor,
        ),
      ),
      /不能改为二级/,
    );
    await assert.rejects(
      scoped(() => service.delete([parent.id], owner.id)),
      /二级/,
    );
    const missingCoordinator = Object.assign(
      new CreateAgencyDto(),
      input('二级', owner.id, parent.id),
      { coordinatorId: null },
    );
    assert.ok(
      (await validate(missingCoordinator)).some(
        (error) => error.property === 'coordinatorId',
      ),
    );

    parent = await update(parent, '天马新名称');
    const renamed = await scoped(() => service.get(child.id));
    assert.equal(renamed.name, '天马新名称-HAHNEMANN TRAVEL');
    assert.equal(renamed.version, child.version + 1);
    assert.equal(renamed.coordinatorId, otherOwner.id);
    assert.equal(renamed.contacts[0].phone, '200');
    child = renamed;
    await assert.rejects(update(parent, '长'.repeat(145)), /150字/);
    assert.equal(
      (await scoped(() => service.get(parent.id))).name,
      parent.name,
    );
    await assert.rejects(
      scoped(() =>
        service.update(
          child.id,
          {
            ...input(child.shortName, otherOwner.id, parent.id),
            version: child.version - 1,
          },
          actor,
        ),
      ),
    );
    parent = await scoped(() =>
      service.update(
        parent.id,
        {
          ...input(parent.shortName, owner.id),
          status: ResourceStatus.Disabled,
          version: parent.version,
        },
        actor,
      ),
    );
    child = await update(child);
    assert.equal(child.status, ResourceStatus.Enabled);
    await assert.rejects(
      scoped(() =>
        service.create(input('新增二级', owner.id, parent.id), actor),
      ),
      /有效一级/,
    );

    const sharedParent = await scoped(
      () =>
        service.create(
          { ...input('共享一级', owner.id), businessUnit: 'linxi' },
          actor,
        ),
      'shared',
    );
    await assert.rejects(
      scoped(() =>
        service.create(input('跨库', owner.id, sharedParent.id), actor),
      ),
      /无权访问/,
    );
    await assert.rejects(
      scoped(
        () =>
          service.create(
            {
              ...input('跨业务', owner.id, sharedParent.id),
              businessUnit: 'website',
            },
            actor,
          ),
        'shared',
      ),
      /同业务/,
    );
    await assert.rejects(
      db.query(`UPDATE resource_agencies SET parent_id=id WHERE id=$1`, [
        retained.id,
      ]),
    );
    await assert.rejects(
      db.query(
        `UPDATE resource_agencies SET parent_id='00000000-0000-0000-0000-000000000001' WHERE id=$1`,
        [retained.id],
      ),
    );
    child = await scoped(() =>
      service.update(
        child.id,
        {
          ...input(child.shortName, otherOwner.id, retained.id),
          version: child.version,
        },
        actor,
      ),
    );
    assert.equal(child.name, '既有组团社-HAHNEMANN TRAVEL');
    child = await scoped(() =>
      service.update(
        child.id,
        { ...input(child.shortName, otherOwner.id), version: child.version },
        actor,
      ),
    );
    assert.equal(child.parentId, null);
    assert.equal(child.name, 'HAHNEMANN TRAVEL');
    await scoped(() => service.delete([parent.id], owner.id));
    await scoped(() => service.delete([child.id], owner.id));
    assert.equal(
      await contactRepository.existsBy({ agencyId: child.id }),
      false,
    );
    const treeParents = await agencyRepository.save(
      Array.from({ length: 21 }, (_, index) =>
        agencyRepository.create({
          ...input(`树形父级${index}`, owner.id),
          code: `AGY-${10000 + index}`,
          library: 'shengxu',
        }),
      ),
    );
    const treeChildren = await agencyRepository.save(
      Array.from({ length: 22 }, (_, index) =>
        agencyRepository.create({
          ...input(`树形父级0-分页子项${index}`, owner.id, treeParents[0].id),
          code: `AGY-${11000 + index}`,
          library: 'shengxu',
          status:
            index === 0 ? ResourceStatus.Disabled : ResourceStatus.Enabled,
        }),
      ),
    );
    await agencyRepository.softDelete(treeChildren[21].id);
    const roots = await scoped(() =>
      service.list({ page: 1, pageSize: 20, parentOnly: 'true' }),
    );
    const nextRoots = await scoped(() =>
      service.list({ page: 2, pageSize: 20, parentOnly: 'true' }),
    );
    assert.equal(roots.list.length, 20);
    assert.equal(roots.total, 22);
    assert.equal(nextRoots.list.length, 2);
    assert(roots.list.every((agency) => agency.parentId === null));
    assert.equal(
      roots.list.find((agency) => agency.id === treeParents[0].id)?.childCount,
      21,
    );
    assert.equal(
      (await scoped(() => service.get(treeParents[0].id))).childCount,
      21,
    );
    const children = await scoped(() =>
      service.list({ page: 1, pageSize: 20, parentId: treeParents[0].id }),
    );
    const moreChildren = await scoped(() =>
      service.list({ page: 2, pageSize: 20, parentId: treeParents[0].id }),
    );
    assert.equal(children.total, 21);
    assert.equal(children.list.length, 20);
    assert.equal(moreChildren.list.length, 1);
    assert.equal(children.list[0].status, ResourceStatus.Disabled);
    assert(
      children.list.every(
        (agency) =>
          agency.parentId === treeParents[0].id && agency.childCount === 0,
      ),
    );
    assert.equal(
      new Set(
        [...children.list, ...moreChildren.list].map((agency) => agency.id),
      ).size,
      21,
    );
    const search = await scoped(() =>
      service.list({ page: 2, pageSize: 20, keyword: '分页子项' }),
    );
    assert.equal(search.total, 21);
    assert.equal(search.list[0].id, treeChildren[20].id);
    assert.equal(search.list[0].parentName, treeParents[0].name);
    assert.equal(
      (
        await scoped(
          () =>
            service.list({
              page: 1,
              pageSize: 20,
              parentId: treeParents[0].id,
            }),
          'shared',
        )
      ).total,
      0,
    );
    console.log(
      'Agency hierarchy: schema, independent contacts/coordinators, selection, rename/CAS, scope, deletion, root/child paging, child counts and global search checks passed.',
    );
  } finally {
    if (db?.isInitialized) await db.destroy();
    for (const database of databases)
      await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    await admin.destroy();
  }
}
void run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
