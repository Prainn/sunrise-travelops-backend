import { FeishuService } from '../src/feishu/feishu.service';
import { AccountLinksService } from '../src/users/account-links.service';
/** Only uses the task's disposable PostgreSQL at 127.0.0.1:55441. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Module, ValidationPipe, INestApplication } from '@nestjs/common';
import { NestFactory, APP_GUARD, Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { AuthController } from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';
import { AuthenticatedUser, AuthTokens } from '../src/auth/auth.types';
import { effectivePermissions } from '../src/auth/identity-permissions';
import { JwtStrategy } from '../src/auth/jwt.strategy';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../src/auth/guards/permissions.guard';
import { UserLoginRecordEntity } from '../src/auth/user-login-record.entity';
import { UserEntity, UserStatus } from '../src/users/user.entity';
import {
  UserIdentityEntity,
  LoginScope,
} from '../src/users/user-identity.entity';
import { UserManagementService } from '../src/users/user-management.service';
import { RoleEntity } from '../src/roles/role.entity';
import { PermissionEntity } from '../src/roles/permission.entity';
import { MenuPermissionsService } from '../src/roles/menu-permissions.service';
import { MenuPermissionsController } from '../src/roles/menu-permissions.controller';
import { roleMenuKeys } from '../src/roles/menu-definitions';
import { WebsiteService } from '../src/website/website.service';
import { WebsiteController } from '../src/website/website.controller';
import {
  WebsiteInquiry,
  WebsiteItinerary,
  WebsiteConfig,
} from '../src/website/website.types';
import { ToursService } from '../src/tours/tours.service';
import { BusinessDictionaryItemEntity } from '../src/system/business-dictionaries/business-dictionary-item.entity';
import { BusinessDictionaryTypeEntity } from '../src/system/business-dictionaries/business-dictionary-type.entity';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter';
import { createValidationException } from '../src/common/validation/validation-exception.factory';
import { OperationLogInterceptor } from '../src/operation-logs/operation-log.interceptor';
import { OperationLogsService } from '../src/operation-logs/operation-logs.service';
import { OperationLogEntity } from '../src/operation-logs/operation-log.entity';

const connection = {
  type: 'postgres' as const,
  host: '127.0.0.1',
  port: 55441,
  username: 'postgres',
  password: 'isolated-menu-test-only',
};
const migrationName = 'AddMenuPermissionsAndWebsiteBusinessScope1792051200000';
const password = 'isolated-fixture-password';

async function main() {
  const admin = await new DataSource({
    ...connection,
    database: 'postgres',
  }).initialize();
  const names = [
    `menu_scope_${Date.now()}_${process.pid}`,
    `menu_scope_empty_${Date.now()}_${process.pid}`,
  ];
  let db: DataSource | undefined;
  let app: INestApplication | undefined;
  try {
    for (const name of names) {
      assert.match(name, /^menu_scope_(?:empty_)?[0-9]+_[0-9]+$/);
      await admin.query(`CREATE DATABASE ${name}`);
    }
    const options = {
      ...connection,
      entities: [
        UserEntity,
        UserIdentityEntity,
        RoleEntity,
        PermissionEntity,
        UserLoginRecordEntity,
        BusinessDictionaryTypeEntity,
        BusinessDictionaryItemEntity,
        OperationLogEntity,
      ],
      migrations: [`${__dirname}/../src/migrations/*.ts`],
      synchronize: false,
    };
    const empty = await new DataSource({
      ...options,
      database: names[1],
    }).initialize();
    try {
      assert(
        (await empty.runMigrations()).some(
          (migration) => migration.name === migrationName,
        ),
      );
      assert.equal((await empty.runMigrations()).length, 0);
    } finally {
      await empty.destroy();
    }
    db = await new DataSource({ ...options, database: names[0] }).initialize();
    const allMigrations = [...db.migrations];
    db.migrations.splice(
      0,
      db.migrations.length,
      ...allMigrations.filter(
        (migration) =>
          (migration.name ?? migration.constructor.name) !== migrationName,
      ),
    );
    await db.runMigrations();
    const users = new UserManagementService(
      db.getRepository(UserEntity),
      db.getRepository(RoleEntity),
      db,
      new FeishuService(new ConfigService({})),
    );
    let fixtureRoot: AuthenticatedUser;
    const createIdentity = async (
      name: string,
      scope: LoginScope,
      codes: string[],
    ) => {
      const user = await db!.getRepository(UserEntity).save({
        username: name,
        nickname: name,
        englishName: name,
        tourCode: 'TEST',
        passwordHash: 'not-a-login-credential',
        status: UserStatus.Enabled,
      });
      const roles = await db!.getRepository(RoleEntity).find();
      const identity = await db!.getRepository(UserIdentityEntity).save({
        userId: user.id,
        username: name,
        scope,
        deptId: scope === 'linxi' ? 5 : scope === 'website' ? 7 : 1,
        roles: roles.filter((role) => codes.includes(role.code)),
      });
      if (codes.includes('ROOT'))
        fixtureRoot = {
          id: user.id,
          username: name,
          nickname: name,
          identityId: identity.id,
          scope,
          scopeName: scope,
          deptId: 1,
          deptName: '',
          roles: codes,
          permissions: effectivePermissions(scope, codes),
          menuKeys: [],
        };
      // Exercise the existing credential-setting workflow instead of a new fixture hasher.
      await users.resetPassword(user.id, password, fixtureRoot);
      return { user, identity };
    };
    const root = await createIdentity('fixture_root', 'headquarters', ['ROOT']);
    const coord = await createIdentity('fixture_website', 'website', [
      'COORDINATOR',
    ]);
    const countryType = await db
      .getRepository(BusinessDictionaryTypeEntity)
      .findOneByOrFail({ code: 'country-region' });
    const country = await db.getRepository(BusinessDictionaryItemEntity).save({
      typeId: countryType.id,
      code: 'MYS',
      name: 'Malaysia',
      englishName: 'Malaysia',
    });
    const oldInquiry = randomUUID(),
      oldItinerary = randomUUID(),
      oldQuote = randomUUID();
    const oldSnapshot = {
      id: oldQuote,
      immutable: 'original website frozen content',
    };
    await db.query(
      "INSERT INTO website_inquiries(id,code,customer_name,planned_days,requirements,owner_id,owner,status,country_item_id,country_code,country_or_region) VALUES($1,'WIQ-LEGACY','Legacy',2,'legacy',$2,'Legacy owner','quoted',$3,'MYS','Malaysia')",
      [oldInquiry, coord.user.id, country.id],
    );
    await db.query(
      "INSERT INTO website_itineraries(id,inquiry_id,code,title,duration,start_date,config_version,status) VALUES($1,$2,'WIT-LEGACY','Legacy',2,'2027-01-01',0,'quoted')",
      [oldItinerary, oldInquiry],
    );
    await db.query(
      "INSERT INTO website_quotations(id,itinerary_id,code,snapshot,confirmed_by,first_downloaded_at) VALUES($1,$2,'WQT-LEGACY',$3::jsonb,$4,now())",
      [oldQuote, oldItinerary, JSON.stringify(oldSnapshot), root.user.id],
    );
    const beforeConfig = await db.query<
      { version: number; config: WebsiteConfig }[]
    >('SELECT version,config FROM website_config_versions ORDER BY version');
    db.migrations.splice(0, db.migrations.length, ...allMigrations);
    assert.equal((await db.runMigrations()).length, 1);
    assert.equal((await db.runMigrations()).length, 0);
    assert.deepEqual(
      await db.query(
        "SELECT version,config FROM website_config_versions WHERE business_unit='website' ORDER BY version",
      ),
      beforeConfig,
    );
    assert.deepEqual(
      (
        await db.query<{ snapshot: unknown }[]>(
          'SELECT snapshot FROM website_quotations WHERE id=$1',
          [oldQuote],
        )
      )[0].snapshot,
      oldSnapshot,
    );
    assert.equal(
      (
        await db.query<{ business_unit: string }[]>(
          'SELECT business_unit FROM website_inquiries WHERE id=$1',
          [oldInquiry],
        )
      )[0].business_unit,
      'website',
    );
    const menus = new MenuPermissionsService(db),
      jwt = new JwtService();
    const config = new ConfigService({
      JWT_SECRET: 'isolated-menu-access-signing-secret',
      REFRESH_TOKEN_SECRET: 'isolated-menu-refresh-signing-secret',
      JWT_EXPIRES_IN: '15m',
      REFRESH_TOKEN_EXPIRES_IN: '7d',
    });
    const auth = new AuthService(
      db.getRepository(UserEntity),
      jwt,
      config,
      db.getRepository(UserLoginRecordEntity),
      menus,
      new AccountLinksService(db),
    );
    const website = new WebsiteService(db),
      tours = new ToursService(db);
    @Module({
      controllers: [
        AuthController,
        MenuPermissionsController,
        WebsiteController,
      ],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: ConfigService, useValue: config },
        { provide: MenuPermissionsService, useValue: menus },
        { provide: WebsiteService, useValue: website },
        JwtStrategy,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
      ],
    })
    class TestModule {}
    app = await NestFactory.create(TestModule, { logger: false });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        exceptionFactory: createValidationException,
      }),
    );
    app.useGlobalFilters(new ApiExceptionFilter());
    app.useGlobalInterceptors(
      new ResponseInterceptor(new Reflector()),
      new OperationLogInterceptor(
        new OperationLogsService(db.getRepository(OperationLogEntity)),
      ),
    );
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const request = async <T>(
      path: string,
      token: string | undefined,
      status = 200,
      method = 'GET',
      body?: unknown,
    ): Promise<T> => {
      const response = await fetch(`${base}/api${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const value =
        response.status === 204
          ? undefined
          : ((await response.json()) as { data: T });
      assert.equal(
        response.status,
        status,
        `${method} ${path}: ${JSON.stringify(value)}`,
      );
      return value?.data as T;
    };
    const login = (account: {
      user: UserEntity;
      identity: UserIdentityEntity;
    }) =>
      request<AuthTokens>('/auth/login', undefined, 200, 'POST', {
        username: account.user.username,
        password,
        scope: account.identity.scope,
      });
    const rootTokens = await login(root),
      originalTokens = await login(coord);
    const rootActor = await request<AuthenticatedUser>(
        '/auth/me',
        rootTokens.accessToken,
      ),
      originalMe = await request<AuthenticatedUser>(
        '/auth/me',
        originalTokens.accessToken,
      );
    const catalog = await request<
      Awaited<ReturnType<MenuPermissionsService['list']>>
    >('/system/menu-permissions', rootTokens.accessToken);
    for (const role of catalog.roles)
      assert.deepEqual(
        [...role.menuKeys].sort(),
        [...roleMenuKeys(role.code)].sort(),
      );
    const coordinatorConfig = catalog.roles.find(
        (role) => role.code === 'COORDINATOR',
      )!,
      reducedKeys = coordinatorConfig.menuKeys.filter(
        (key) => key !== 'guide-leaves',
      );
    await request(
      '/system/menu-permissions/COORDINATOR',
      rootTokens.accessToken,
      200,
      'PUT',
      { version: coordinatorConfig.version, menuKeys: reducedKeys },
    );
    await request('/system/menu-permissions', originalTokens.accessToken, 403);
    assert(
      (
        await menus.snapshot('website', ['COORDINATOR', 'RESOURCE_MANAGER'])
      ).includes('guide-leaves'),
    );
    assert(
      !(await menus.snapshot('website', ['COORDINATOR'])).includes(
        'guide-leaves',
      ),
    );
    assert(
      !(
        await menus.snapshot('shengxu', ['COORDINATOR', 'RESOURCE_MANAGER'])
      ).includes('website-config'),
    );
    await request(
      '/system/menu-permissions/COORDINATOR',
      originalTokens.accessToken,
      403,
      'PUT',
      { version: 1, menuKeys: [] },
    );
    await request(
      '/system/menu-permissions/ROOT',
      rootTokens.accessToken,
      400,
      'PUT',
      { version: 1, menuKeys: [] },
    );
    await request(
      '/system/menu-permissions/COORDINATOR',
      rootTokens.accessToken,
      409,
      'PUT',
      { version: 1, menuKeys: reducedKeys },
    );
    await request(
      '/system/menu-permissions/COORDINATOR',
      rootTokens.accessToken,
      400,
      'PUT',
      { version: 2, menuKeys: ['menu-permissions'] },
    );
    await request(
      '/system/menu-permissions/COORDINATOR',
      rootTokens.accessToken,
      400,
      'PUT',
      { version: 2, menuKeys: ['hotel', 'hotel'] },
    );
    assert.deepEqual(
      (await request<AuthenticatedUser>('/auth/me', originalTokens.accessToken))
        .menuKeys,
      originalMe.menuKeys,
    );
    const refreshed = await request<AuthTokens>(
      '/auth/refresh',
      undefined,
      200,
      'POST',
      { refreshToken: originalTokens.refreshToken },
    );
    assert.deepEqual(
      (await request<AuthenticatedUser>('/auth/me', refreshed.accessToken))
        .menuKeys,
      originalMe.menuKeys,
    );
    const newTokens = await login(coord);
    assert(
      !(
        await request<AuthenticatedUser>('/auth/me', newTokens.accessToken)
      ).menuKeys.includes('guide-leaves'),
    );
    assert(
      (
        await request<AuthenticatedUser>('/auth/me', originalTokens.accessToken)
      ).menuKeys.includes('guide-leaves'),
    );
    const [audit] = await db.query<{ detail: string }[]>(
      "SELECT detail FROM operation_logs WHERE action='配置菜单权限' AND success=true",
    );
    assert.deepEqual(JSON.parse(audit.detail), {
      roleCode: 'COORDINATOR',
      beforeMenuKeys: coordinatorConfig.menuKeys,
      afterMenuKeys: reducedKeys,
    });
    const noSnapshot = await jwt.signAsync(
      {
        sub: coord.user.id,
        identityId: coord.identity.id,
        scope: 'website',
        type: 'access',
      },
      { secret: config.getOrThrow('JWT_SECRET') },
    );
    await request('/auth/me', noSnapshot, 401);
    const lx = await createIdentity('fixture_linxi', 'linxi', ['COORDINATOR']),
      lxOther = await createIdentity('fixture_linxi_other', 'linxi', [
        'COORDINATOR',
      ]);
    const lxManager = await createIdentity('fixture_linxi_manager', 'linxi', [
        'BUSINESS_MANAGER',
      ]),
      lxResource = await createIdentity('fixture_linxi_resource', 'linxi', [
        'RESOURCE_MANAGER',
      ]);
    const adminIdentity = await createIdentity(
        'fixture_admin',
        'headquarters',
        ['ADMIN'],
      ),
      executive = await createIdentity('fixture_executive', 'headquarters', [
        'EXECUTIVE',
        'ADMIN',
      ]);
    const lxToken = (await login(lx)).accessToken,
      lxOtherToken = (await login(lxOther)).accessToken,
      lxManagerToken = (await login(lxManager)).accessToken;
    const adminToken = (await login(adminIdentity)).accessToken,
      executiveToken = (await login(executive)).accessToken,
      resourceToken = (await login(lxResource)).accessToken;
    for (const token of [adminToken, executiveToken])
      await request('/system/menu-permissions', token, 403);
    await request('/website/inquiries', resourceToken, 403);
    const input = {
      countryItemId: country.id,
      customerName: 'Linxi customer',
      plannedDays: 2,
      requirements: 'Plan',
      contactInfo: '',
      receivedAt: null,
      contactChannel: '',
      whatsappSourceId: '',
      websiteInquiryNo: '',
      landingPage: '',
      acquisitionSource: '',
      startDate: null,
      pax: null,
      destinations: [],
      internalRemark: '',
      lostReason: '',
    };
    const lxInquiry = await request<WebsiteInquiry>(
      '/website/inquiries',
      lxToken,
      201,
      'POST',
      input,
    );
    assert.equal(lxInquiry.businessUnit, 'linxi');
    await request('/website/inquiries', lxToken, 403, 'POST', {
      ...input,
      businessUnit: 'website',
    });
    await request('/website/inquiries', rootTokens.accessToken, 400, 'POST', {
      ...input,
      ownerId: lx.user.id,
    });
    await request('/website/inquiries', rootTokens.accessToken, 400, 'POST', {
      ...input,
      businessUnit: 'linxi',
      ownerId: coord.user.id,
    });
    const headCreated = await request<WebsiteInquiry>(
      '/website/inquiries',
      rootTokens.accessToken,
      201,
      'POST',
      { ...input, businessUnit: 'website', ownerId: coord.user.id },
    );
    assert.equal(headCreated.businessUnit, 'website');
    assert.equal(
      (await request<{ total: number }>('/website/inquiries', lxToken)).total,
      1,
    );
    assert.equal(
      (await request<{ total: number }>('/website/inquiries', lxOtherToken))
        .total,
      0,
    );
    assert.equal(
      (await request<{ total: number }>('/website/inquiries', lxManagerToken))
        .total,
      1,
    );
    assert.equal(
      (
        await request<{ total: number }>(
          '/website/inquiries',
          rootTokens.accessToken,
        )
      ).total,
      3,
    );
    assert.equal(
      (
        await request<{ total: number }>(
          '/website/inquiries?businessUnit=linxi',
          rootTokens.accessToken,
        )
      ).total,
      1,
    );
    await request(
      '/website/inquiries?businessUnit=website',
      lxManagerToken,
      403,
    );
    for (const path of [
      `/website/inquiries/${oldInquiry}`,
      `/website/inquiries/${oldInquiry}/logs`,
      `/website/inquiries/${oldInquiry}/itineraries`,
      `/website/itineraries/${oldItinerary}`,
      `/website/itineraries/${oldItinerary}/preview`,
      `/website/itineraries/${oldItinerary}/quotation`,
    ])
      await request(path, lxManagerToken, 404);
    await request(
      `/website/inquiries/${lxInquiry.id}`,
      newTokens.accessToken,
      404,
    );
    await request(
      `/website/inquiries/${oldInquiry}/archive`,
      lxManagerToken,
      404,
      'POST',
      { version: 1 },
    );
    await request(
      `/website/inquiries/${oldInquiry}/transfer`,
      lxManagerToken,
      404,
      'POST',
      { version: 1, ownerId: lxOther.user.id, reason: 'cross' },
    );
    const owners = await request<Array<{ id: string }>>(
      '/website/owners',
      lxManagerToken,
    );
    assert(owners.some((owner) => owner.id === lx.user.id));
    assert(!owners.some((owner) => owner.id === coord.user.id));
    await request('/website/owners', rootTokens.accessToken, 400);
    await request('/website/owners?businessUnit=website', lxManagerToken, 403);
    await request(
      `/website/inquiries/${lxInquiry.id}/transfer`,
      lxManagerToken,
      400,
      'POST',
      { version: 1, ownerId: coord.user.id, reason: 'cross' },
    );
    const lxConfig = await request<WebsiteConfig>('/website/config', lxToken);
    assert.equal(lxConfig.cities.length, 0);
    const webConfig = await request<WebsiteConfig>(
      '/website/config?businessUnit=website',
      rootTokens.accessToken,
    );
    await request(`/website/config?version=${webConfig.version}`, lxToken, 404);
    await request('/website/config?businessUnit=website', lxToken, 403);
    await request('/website/config', rootTokens.accessToken, 400);
    await request(
      '/website/config?businessUnit=linxi',
      executiveToken,
      403,
      'PUT',
      lxConfig,
    );
    const updatedConfig = await request<WebsiteConfig>(
      '/website/config',
      resourceToken,
      200,
      'PUT',
      {
        ...lxConfig,
        cities: [
          {
            id: randomUUID(),
            nameZh: '霖熹城市',
            nameEn: 'Linxi city',
            resourceId: null,
            status: 'enabled',
          },
        ],
      },
    );
    assert.equal(
      (
        await request<WebsiteConfig>(
          '/website/config?businessUnit=website',
          adminToken,
        )
      ).version,
      webConfig.version,
    );
    const itineraryInput = {
      title: 'Linxi draft',
      duration: 2,
      startDate: '2027-01-01',
      pax: 2,
      arrivalTime: '',
      departureTime: '',
      days: [],
      vehiclePrices: [],
    };
    await request(
      `/website/inquiries/${lxInquiry.id}/itineraries`,
      lxToken,
      404,
      'POST',
      {
        ...itineraryInput,
        inquiryVersion: 1,
        configVersion: webConfig.version,
      },
    );
    const lxItinerary = await request<WebsiteItinerary>(
      `/website/inquiries/${lxInquiry.id}/itineraries`,
      lxToken,
      201,
      'POST',
      {
        ...itineraryInput,
        inquiryVersion: 1,
        configVersion: updatedConfig.version,
      },
    );
    await assert.rejects(
      db.query('UPDATE website_itineraries SET config_version=$1 WHERE id=$2', [
        webConfig.version,
        lxItinerary.id,
      ]),
      /website_itineraries_business_config/,
    );
    const lxActor = await request<AuthenticatedUser>('/auth/me', lxToken),
      lxQuote = randomUUID();
    await db.query(
      "INSERT INTO website_quotations(id,itinerary_id,code,snapshot,confirmed_by,first_downloaded_at) VALUES($1,$2,'WQT-LINXI','{}'::jsonb,$3,now())",
      [lxQuote, lxItinerary.id, lx.user.id],
    );
    const sources = await tours.sources({ sourceModule: 'website' }, lxActor);
    assert.equal(sources.length, 1);
    assert.equal(sources[0].businessUnit, 'linxi');
    assert.equal(sources[0].inquiryId, lxInquiry.id);
    const airportType = await db
      .getRepository(BusinessDictionaryTypeEntity)
      .findOneByOrFail({ code: 'city-airport' });
    const airport = await db.getRepository(BusinessDictionaryItemEntity).save({
      typeId: airportType.id,
      code: 'KMG',
      name: '昆明机场',
      englishName: 'Kunming airport',
    });
    const [pickup] = await db.query<{ id: string }[]>(
      "INSERT INTO resource_flights(departure_city,arrival_city,flight_number,departure_time,arrival_time,departure_airport_id,arrival_airport_id) VALUES('Shanghai','Kunming','MU0001','08:00','10:00',$1,$1) RETURNING id",
      [airport.id],
    );
    const [drop] = await db.query<{ id: string }[]>(
      "INSERT INTO resource_flights(departure_city,arrival_city,flight_number,departure_time,arrival_time,departure_airport_id,arrival_airport_id) VALUES('Kunming','Shanghai','MU0002','18:00','20:00',$1,$1) RETURNING id",
      [airport.id],
    );
    const tourInput = {
      sourceModule: 'website' as const,
      inquiryId: lxInquiry.id,
      quoteId: lxQuote,
      operatorId: lx.user.id,
      adults: 2,
      children: 0,
      leaders: 0,
      language: '',
      shopping: false,
      pickupFlightId: pickup.id,
      dropFlightId: drop.id,
      guideServices: [],
      remark: '',
    };
    await assert.rejects(
      tours.create(
        { ...tourInput, inquiryId: oldInquiry, quoteId: oldQuote },
        lxActor,
      ),
      (cause: unknown) =>
        cause instanceof Error &&
        'getStatus' in cause &&
        (cause as { getStatus(): number }).getStatus() === 404,
    );
    assert.equal(
      (await tours.create(tourInput, lxActor)).businessUnit,
      'linxi',
    );
    assert.equal(
      (await users.inquiryImpact(lx.user.id, rootActor)).unfinished,
      1,
    );
    const update = {
      avatar: '',
      gender: 0,
      mobile: '',
      email: '',
      nickname: lx.user.nickname,
      englishName: lx.user.englishName,
      tourCode: 'TEST',
      status: 0,
      identities: [
        {
          id: lx.identity.id,
          scope: 'linxi' as const,
          deptId: 5,
          roleIds: lx.identity.roles.map((role) => role.id),
        },
      ],
    };
    await assert.rejects(
      users.update(lx.user.id, update, rootActor),
      /请先转交/,
    );
    await assert.rejects(users.delete([lx.user.id], rootActor), /请先转交/);
    const resourceRole = await db
      .getRepository(RoleEntity)
      .findOneByOrFail({ code: 'RESOURCE_MANAGER' });
    await assert.rejects(
      users.update(
        lx.user.id,
        {
          ...update,
          status: 1,
          identities: [{ ...update.identities[0], roleIds: [resourceRole.id] }],
        },
        rootActor,
      ),
      /请先转交/,
    );
    await db
      .getRepository(UserEntity)
      .update(lx.user.id, { status: UserStatus.Disabled });
    await request('/auth/me', lxToken, 401);
    console.log(
      'PASS: empty/repeated migrations, historical upgrade/frozen preservation, ROOT/audit, login snapshots, business/config isolation, tour business and unfinished-account protection.',
    );
  } finally {
    await app?.close();
    if (db?.isInitialized) await db.destroy();
    for (const name of names)
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.destroy();
  }
}
main().catch((cause: unknown) => {
  console.error(cause);
  process.exitCode = 1;
});
