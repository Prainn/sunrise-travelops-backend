/** Runs only against the disposable PostgreSQL 16 container on localhost:55439. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import * as argon2 from 'argon2';
import type { Request } from 'express';
import { AuthService } from '../src/auth/auth.service';
import type { AuthenticatedUser } from '../src/auth/auth.types';
import { UserLoginRecordEntity } from '../src/auth/user-login-record.entity';
import { UserEntity } from '../src/users/user.entity';
import {
  UserIdentityEntity,
  type LoginScope,
} from '../src/users/user-identity.entity';
import { RoleEntity } from '../src/roles/role.entity';
import { InquiriesService } from '../src/inquiries/inquiries.service';
import { ItineraryValidation } from '../src/inquiries/itinerary-validation';
import type { ItineraryInput } from '../src/inquiries/inquiry.dto';
import { AgenciesService } from '../src/resources/agencies/agencies.service';
import {
  AgencyEntity,
  AgencyContactEntity,
} from '../src/resources/agencies/agency.entity';
import { ResourceValidationService } from '../src/resources/common/resource-validation.service';
import { BusinessDictionaryTypeEntity } from '../src/system/business-dictionaries/business-dictionary-type.entity';
import { BusinessDictionaryItemEntity } from '../src/system/business-dictionaries/business-dictionary-item.entity';
import { CityEntity } from '../src/resources/cities/city.entity';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter';
import { createValidationException } from '../src/common/validation/validation-exception.factory';
import { buildWebsitePreview } from '../src/website/website-engine';
import type {
  WebsiteConfig,
  WebsiteDay,
  WebsiteInquiry,
  WebsiteInquiryInput,
  WebsiteItinerary,
  WebsiteItineraryInput,
  WebsitePreview,
  WebsiteQuotation,
} from '../src/website/website.types';

const connection = {
  type: 'postgres' as const,
  host: '127.0.0.1',
  port: 55439,
  username: 'postgres',
  password: 'isolated-test-only',
};
const websiteMigrationName = 'CreateWebsiteBusiness1791187200000';

async function main() {
  const admin = await new DataSource({
    ...connection,
    database: 'travel_refactor_test',
  }).initialize();
  const database = `website_integration_${Date.now()}_${process.pid}`;
  const emptyDatabase = `${database}_empty`;
  const databaseNames = [database, emptyDatabase];
  let db: DataSource | undefined;
  try {
    assert.match(
      (
        await admin.query<Array<{ server_version: string }>>(
          'SHOW server_version',
        )
      )[0].server_version,
      /^16\./,
    );
    for (const name of databaseNames) {
      assert.match(name, /^website_integration_[0-9]+_[0-9]+(?:_empty)?$/);
      await admin.query(`CREATE DATABASE ${name}`);
    }
    const options = {
      ...connection,
      entities: [`${__dirname}/../src/**/*.entity.ts`],
      migrations: [`${__dirname}/../src/migrations/*.ts`],
      synchronize: false,
    };
    const empty = await new DataSource({
      ...options,
      database: emptyDatabase,
    }).initialize();
    try {
      const applied = await empty.runMigrations();
      assert(applied.some(({ name }) => name === websiteMigrationName));
      assert.equal((await empty.runMigrations()).length, 0);
    } finally {
      await empty.destroy();
    }

    db = await new DataSource({ ...options, database }).initialize();
    const allMigrations = [...db.migrations];
    assert(
      allMigrations.some(
        (migration) =>
          (migration.name ?? migration.constructor.name) ===
          websiteMigrationName,
      ),
    );
    db.migrations.splice(
      0,
      db.migrations.length,
      ...allMigrations.filter(
        (migration) =>
          (migration.name ?? migration.constructor.name) !==
          websiteMigrationName,
      ),
    );
    await db.runMigrations();

    const passwordHash = await argon2.hash('isolated-fixture-password');
    const auth = new AuthService(
      db.getRepository(UserEntity),
      new JwtService(),
      new ConfigService({
        JWT_SECRET: 'isolated-website-access-secret-at-least-32-chars',
        REFRESH_TOKEN_SECRET:
          'isolated-website-refresh-secret-at-least-32-chars',
        JWT_EXPIRES_IN: '15m',
        REFRESH_TOKEN_EXPIRES_IN: '7d',
      }),
      db.getRepository(UserLoginRecordEntity),
    );
    const createActor = async (
      username: string,
      scope: LoginScope,
      deptId: number | null,
      codes: string[],
      isSuperuser = false,
    ) => {
      const user = await db!.getRepository(UserEntity).save({
        username,
        nickname: username,
        passwordHash,
        isSuperuser,
      });
      const roles = await db!.getRepository(RoleEntity).find();
      const identity = await db!.getRepository(UserIdentityEntity).save({
        userId: user.id,
        username,
        scope,
        deptId,
        roles: roles.filter((role) => codes.includes(role.code)),
      });
      return auth.getCurrentUser(user.id, identity.id, scope);
    };
    const root = await createActor(
      'sunrise',
      'headquarters',
      null,
      ['ROOT'],
      true,
    );
    const linxi = await createActor('legacy-linxi', 'linxi', 5, [
      'COORDINATOR',
    ]);
    const owner = await createActor('website-owner', 'website', 7, [
      'COORDINATOR',
    ]);
    const other = await createActor('website-other', 'website', 7, [
      'COORDINATOR',
    ]);
    const manager = await createActor('website-manager', 'website', 7, [
      'BUSINESS_MANAGER',
    ]);
    const resource = await createActor('website-resource', 'website', 8, [
      'RESOURCE_MANAGER',
    ]);
    const shengxu = await createActor('shengxu-owner', 'shengxu', 3, [
      'COORDINATOR',
    ]);
    const headquartersAdmin = await createActor(
      'website-admin',
      'headquarters',
      1,
      ['ADMIN'],
    );
    const executive = await createActor(
      'website-executive',
      'headquarters',
      4,
      ['EXECUTIVE', 'ADMIN'],
    );

    const agencyId = randomUUID();
    const contactId = randomUUID();
    const hotelId = randomUUID();
    const vehicleId = randomUUID();
    const sharedCityId = randomUUID();
    const shengxuCityId = randomUUID();
    await db.query(
      `INSERT INTO resource_cities(id,library,code,name) VALUES
       ($1,'shared','CITY-901','昆明'),($2,'shengxu','CITY-902','盛旭测试城市')`,
      [sharedCityId, shengxuCityId],
    );
    await db.query(
      `INSERT INTO resource_agencies(id,library,code,name,business_unit,coordinator_id)
       VALUES($1,'shared','AGY-901','霖熹既有旅行社','linxi',$2)`,
      [agencyId, linxi.id],
    );
    await db.query(
      `INSERT INTO resource_agency_contacts(id,agency_id,name,name_key,phone)
       VALUES($1,$2,'既有联系人','既有联系人','123456')`,
      [contactId, agencyId],
    );
    await db.query(
      `INSERT INTO resource_hotels(id,library,code,name,city,rating,individual_price,unit,breakfast)
       VALUES($1,'shared','HTL-901','既有霖熹酒店','昆明','international_five_star',500,'roomNight','早餐')`,
      [hotelId],
    );
    await db.query(
      `INSERT INTO resource_transports(id,library,code,name,seats,service_level,unit)
       VALUES($1,'shared','VEH-901','既有霖熹车型',7,'standard','vehicleDay')`,
      [vehicleId],
    );
    const resourceValidation = new ResourceValidationService(
      db.getRepository(BusinessDictionaryTypeEntity),
      db.getRepository(BusinessDictionaryItemEntity),
      db.getRepository(CityEntity),
    );
    const agencies = new AgenciesService(
      db.getRepository(AgencyEntity),
      db.getRepository(AgencyContactEntity),
      db,
      resourceValidation,
    );
    const legacy = new InquiriesService(
      db,
      new ItineraryValidation(),
      agencies,
    );
    const legacyActor = await legacy.actor(linxi, {
      ip: '127.0.0.1',
    } as Request);
    const legacyInquiry = await legacy.create(
      {
        agencyId,
        contactId,
        plannedDays: 1,
        sourceChannel: 'Email',
        originalMessage: '保留霖熹既有功能',
        internalRemark: '既有内部备注',
        lostReason: '',
      },
      legacyActor,
    );
    const legacyPlan: ItineraryInput = {
      title: '霖熹既有冻结报价',
      startDate: '2026-10-07',
      paxTiers: [2],
      childRate: 70,
      childWithoutBedRate: 50,
      destinations: ['昆明'],
      dailyPlans: [
        {
          id: randomUUID(),
          dayNumber: 1,
          date: '2026-10-07',
          departure: '昆明',
          destination: '昆明',
          overnightDestination: '',
          transport: 'bus',
          description: '昆明送机',
          meals: { breakfast: false, lunch: false, dinner: false },
          items: [],
        },
      ],
      hotelPlans: [
        {
          tier: 'international_five_star',
          hotels: [
            {
              destination: '昆明',
              hotelId,
              hotelName: '既有霖熹酒店',
              rating: 'international_five_star',
              breakfast: '早餐',
              unit: 'roomNight',
              unitCost: 500,
              referenceBasis: 'hotel_individual',
              referencePrice: 500,
              adjustmentReason: '',
            },
          ],
        },
      ],
      vehiclePlans: [
        {
          tier: 'standard',
          totalPrice: 600,
          pricingMode: 'automatic',
          arrangements: [
            {
              id: randomUUID(),
              startDate: '2026-10-07',
              endDate: '2026-10-07',
              totalPrice: 600,
              vehicles: [
                {
                  vehicleId,
                  vehicleName: '既有霖熹车型',
                  seats: 7,
                  quantity: 1,
                },
              ],
            },
          ],
        },
      ],
      guidePlans: [],
      quote: {
        mealOtherCost: null,
        mealOtherReason: '',
        attractionOtherCost: null,
        attractionOtherReason: '',
        paxOtherCosts: [],
        staffRoomCosts: [{ destination: '昆明', total: 0 }],
        options: [
          {
            id: randomUUID(),
            hotelTier: 'international_five_star',
            vehicleTier: 'standard',
            paxPrices: [{ pax: 2, adultUnitPrice: 2000 }],
          },
        ],
        chineseTip: null,
        englishTip: 0,
        transportFees: [],
        customerNotes: '',
        holidayRestrictions: '',
        hotelReplacementTerms: '',
      },
    };
    const legacyItinerary = await legacy.createItinerary(
      legacyInquiry.id,
      legacyPlan,
      legacyActor,
    );
    const legacyParent = await legacy.detail(legacyInquiry.id, legacyActor);
    await legacy.confirmPdf(
      legacyItinerary.id,
      {
        version: legacyItinerary.version,
        inquiryVersion: legacyParent.version,
      },
      legacyActor,
    );
    const readLegacy = async () =>
      JSON.stringify({
        inquiry: await legacy.detail(legacyInquiry.id, legacyActor),
        itinerary: await legacy.itinerary(legacyItinerary.id, legacyActor),
        quotation: await legacy.pdfData(legacyItinerary.id, legacyActor),
        calculation: await legacy.quoteCalculation(
          legacyItinerary.id,
          legacyActor,
        ),
      });
    const legacyBefore = await readLegacy();
    db.migrations.splice(0, db.migrations.length, ...allMigrations);
    assert.deepEqual(
      (await db.runMigrations()).map(({ name }) => name),
      [websiteMigrationName],
    );
    assert.equal((await db.runMigrations()).length, 0);
    assert.deepEqual(await readLegacy(), legacyBefore);

    Object.assign(process.env, {
      ENV_FILE: '/dev/null',
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_HOST: connection.host,
      DATABASE_PORT: String(connection.port),
      DATABASE_USER: connection.username,
      DATABASE_PASSWORD: connection.password,
      DATABASE_NAME: database,
      DATABASE_SSL: 'false',
      JWT_SECRET: 'isolated-website-access-secret-at-least-32-chars',
      REFRESH_TOKEN_SECRET: 'isolated-website-refresh-secret-at-least-32-chars',
      JWT_EXPIRES_IN: '15m',
      REFRESH_TOKEN_EXPIRES_IN: '7d',
      WHATSAPP_RESOLVER_TOKEN:
        'isolated-website-resolver-token-at-least-32-chars',
      CORS_ORIGIN: 'http://127.0.0.1',
      TRUST_PROXY: 'false',
    });
    const { AppModule } = await import('../src/app.module');
    const app = await NestFactory.create(AppModule, { logger: false });
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
    await app.listen(0, '127.0.0.1');
    try {
      const endpoint = await app.getUrl();
      const request = async (
        method: string,
        path: string,
        actor: AuthenticatedUser,
        body?: unknown,
      ) => {
        const access = await new JwtService().signAsync(
          {
            sub: actor.id,
            identityId: actor.identityId,
            scope: actor.scope,
            type: 'access',
          },
          { secret: process.env.JWT_SECRET, expiresIn: '5m' },
        );
        return fetch(`${endpoint}/api${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${access}`,
            'Content-Type': 'application/json',
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      };
      const data = async <T>(
        response: Response,
        expectedStatus = 200,
      ): Promise<T> => {
        assert.equal(
          response.status,
          expectedStatus,
          await response.clone().text(),
        );
        return ((await response.json()) as { data: T }).data;
      };

      for (const outsider of [linxi, shengxu, resource]) {
        assert.equal(
          (await request('GET', '/website/inquiries', outsider)).status,
          403,
        );
      }
      for (const reader of [headquartersAdmin, executive, resource]) {
        assert.equal(
          (await request('POST', '/website/inquiries', reader, {})).status,
          403,
        );
      }
      const cityId = randomUUID();
      const secondCityId = randomUUID();
      const attractionId = randomUUID();
      const componentId = randomUUID();
      const skeletonId = randomUUID();
      const templateFixture = (code: string, zh: string, en: string) => ({
        id: randomUUID(),
        status: 'enabled' as const,
        code,
        zh,
        en,
      });
      const initialConfig = await data<WebsiteConfig>(
        await request('GET', '/website/config', resource),
      );
      assert.equal(initialConfig.version, 0);
      assert.deepEqual(initialConfig.cities, []);
      const authoredConfig: WebsiteConfig = {
        version: initialConfig.version,
        cities: [
          {
            id: cityId,
            status: 'enabled',
            nameZh: '昆明',
            nameEn: 'Kunming',
            resourceId: sharedCityId,
          },
          {
            id: secondCityId,
            status: 'enabled',
            nameZh: '大理',
            nameEn: 'Dali',
            resourceId: null,
          },
        ],
        attractions: [
          {
            id: attractionId,
            status: 'enabled',
            cityId,
            parentId: null,
            nameZh: '测试湖',
            nameEn: 'Test Lake',
            resourceId: null,
            kind: 'attraction',
            chargeable: true,
            copyKey: 'lake-copy',
            recommendedMonths: [1],
          },
          {
            id: componentId,
            status: 'enabled',
            cityId,
            parentId: attractionId,
            nameZh: '湖区接驳车',
            nameEn: 'Lake shuttle',
            resourceId: null,
            kind: 'component',
            chargeable: true,
            copyKey: 'shuttle-copy',
            recommendedMonths: [],
          },
        ],
        routes: [],
        patterns: [],
        skeletons: [
          {
            id: skeletonId,
            status: 'enabled',
            nameZh: '两天昆明',
            nameEn: 'Two days in Kunming',
            days: [
              { cityId, patternId: null },
              { cityId, patternId: null },
            ],
          },
        ],
        // Explicit integration fixtures, never application seed or imported business copy.
        templates: [
          templateFixture(
            'arrival-basic',
            '抵达{city}。',
            'Arrival in {city}.',
          ),
          templateFixture(
            'departure-basic',
            '从{city}离开。',
            'Departure from {city}.',
          ),
          templateFixture('overnight', '住宿{city}。', 'Overnight in {city}.'),
          templateFixture(
            'private-driver',
            '车辆及司机全包。',
            'Private vehicle and driver included.',
          ),
          templateFixture(
            'default-exclusions',
            '国际及国内机票、保险和个人消费不含。',
            'International/domestic air tickets, insurance and personal expenses excluded.',
          ),
          templateFixture(
            'optional-not-included',
            '{component}可选，不含费用。',
            '{component} optional and not included.',
          ),
          templateFixture(
            'peak-season',
            '旺季及节假日重新确认。',
            'Reconfirm peak-season and holiday arrangements.',
          ),
          templateFixture(
            'hotel-substitution',
            '客满时安排同等级酒店。',
            'Equivalent hotels if fully booked.',
          ),
          templateFixture('no-shopping', '无购物。', 'NO SHOPPING.'),
          templateFixture(
            'included-service',
            '包含{service}。',
            '{service} included.',
          ),
          templateFixture(
            'first-entry-ticket',
            '包含{attraction}首次入园门票。',
            'First-entry ticket for {attraction} included.',
          ),
          templateFixture(
            'guide',
            '{language}导游：{service_scope}。',
            '{language} guide: {service_scope}.',
          ),
          templateFixture(
            'hotel-breakfast',
            '{hotel}住宿及早餐。',
            'Hotel {hotel} with breakfast included.',
          ),
          templateFixture(
            'hsr-second-class',
            '高铁二等座。',
            'Second-class high-speed rail ticket.',
          ),
          templateFixture(
            'restaurant-recommendation',
            '推荐{restaurant_or_meal}。',
            '{restaurant_or_meal} recommended.',
          ),
          templateFixture(
            'lake-copy',
            '参观{city}的{attraction}。',
            'Visit {attraction} in {city}.',
          ),
          templateFixture(
            'shuttle-copy',
            '湖区接驳车。',
            'Lake shuttle experience.',
          ),
        ],
      };
      let config = await data<WebsiteConfig>(
        await request('PUT', '/website/config', resource, authoredConfig),
      );
      assert.equal(config.version, 1);
      for (const reader of [owner, manager, executive]) {
        assert.equal(
          (await request('PUT', '/website/config', reader, config)).status,
          403,
        );
        assert.equal(
          (await request('GET', '/website/config', reader)).status,
          200,
        );
      }
      config = await data<WebsiteConfig>(
        await request('PUT', '/website/config', headquartersAdmin, config),
      );
      assert.equal(config.version, 2);
      const websiteCities = await data<{ list: Array<{ id: string }> }>(
        await request('GET', '/website/resources/city', owner),
      );
      assert(websiteCities.list.some(({ id }) => id === sharedCityId));
      assert(!websiteCities.list.some(({ id }) => id === shengxuCityId));
      const ownerOptions = await data<Array<{ id: string }>>(
        await request('GET', '/website/owners', owner),
      );
      assert.deepEqual(
        ownerOptions.map(({ id }) => id),
        [owner.id],
      );
      const managerOptions = await data<Array<{ id: string }>>(
        await request('GET', '/website/owners', manager),
      );
      assert.deepEqual(
        new Set(managerOptions.map(({ id }) => id)),
        new Set([owner.id, other.id]),
      );
      const crossLibrary = structuredClone(config);
      crossLibrary.cities[0].resourceId = shengxuCityId;
      const deniedConfig = await request(
        'PUT',
        '/website/config',
        resource,
        crossLibrary,
      );
      assert(
        deniedConfig.status >= 400 && deniedConfig.status < 500,
        await deniedConfig.clone().text(),
      );
      assert.equal(
        (
          await data<WebsiteConfig>(
            await request('GET', '/website/config', resource),
          )
        ).version,
        config.version,
      );

      const inquiryInput: WebsiteInquiryInput = {
        customerName: '测试直客',
        plannedDays: 2,
        requirements: '昆明两天，无日期及人数',
        phone: '',
        email: '',
        startDate: null,
        pax: null,
        arrivalTime: '',
        departureTime: '',
        destinations: [cityId],
        internalRemark: '内部需求，不应导出客户版',
        lostReason: '',
      };
      const inquiry = await data<WebsiteInquiry>(
        await request('POST', '/website/inquiries', owner, inquiryInput),
        201,
      );
      assert.equal(inquiry.ownerId, owner.id);
      assert.equal(inquiry.startDate, null);
      assert.equal(inquiry.pax, null);
      const ownLogs = await data<{ total: number }>(
        await request('GET', `/website/inquiries/${inquiry.id}/logs`, owner),
      );
      assert.equal(ownLogs.total, 1);
      assert.equal(
        (await request('GET', `/website/inquiries/${inquiry.id}/logs`, other))
          .status,
        404,
      );
      assert.equal(
        (await request('GET', `/website/inquiries/${inquiry.id}/logs`, linxi))
          .status,
        403,
      );
      assert.equal(
        (await request('GET', `/website/inquiries/${inquiry.id}`, other))
          .status,
        404,
      );
      assert.equal(
        (
          await data<{ total: number }>(
            await request('GET', '/website/inquiries', other),
          )
        ).total,
        0,
      );
      assert.equal(
        (
          await data<{ total: number }>(
            await request('GET', '/website/inquiries', manager),
          )
        ).total,
        1,
      );
      for (const outsider of [linxi, shengxu, resource]) {
        assert.equal(
          (await request('GET', `/website/inquiries/${inquiry.id}`, outsider))
            .status,
          403,
        );
      }
      assert.equal(
        (await request('POST', '/website/inquiries', manager, inquiryInput))
          .status,
        400,
      );
      for (const reader of [headquartersAdmin, executive]) {
        assert.equal(
          (await request('GET', `/website/inquiries/${inquiry.id}`, reader))
            .status,
          200,
        );
        assert.equal(
          (await request('PUT', `/website/inquiries/${inquiry.id}`, reader, {}))
            .status,
          403,
        );
      }

      const planFixture = (): WebsiteItineraryInput => {
        const days: WebsiteDay[] = [1, 2].map((dayNumber) => ({
          id: randomUUID(),
          dayNumber,
          departCityId: cityId,
          endCityId: cityId,
          overnightCityId: dayNumber === 1 ? cityId : null,
          items: [],
          legs: [],
          hotels:
            dayNumber === 1
              ? [
                  {
                    id: randomUUID(),
                    tier: 'A',
                    cityId,
                    resourceId: null,
                    nameZh: '人工酒店',
                    nameEn: 'Manual Hotel',
                    roomType: 'Twin',
                    breakfastIncluded: true,
                  },
                ]
              : [],
          meals: ['breakfast', 'lunch', 'dinner'].map((slot) => ({
            id: randomUUID(),
            slot: slot as 'breakfast' | 'lunch' | 'dinner',
            resourceId: null,
            restaurantZh:
              slot === 'lunch' && dayNumber === 1 ? '人工推荐餐厅' : '',
            restaurantEn:
              slot === 'lunch' && dayNumber === 1 ? 'Manual Restaurant' : '',
            feeState:
              slot === 'breakfast' && dayNumber === 2 ? 'INCLUDED' : 'SELF_PAY',
          })),
          guideLanguage: dayNumber === 1 ? 'English' : '',
          guideScope: dayNumber === 1 ? 'City touring' : '',
          services:
            dayNumber === 1
              ? [
                  {
                    id: randomUUID(),
                    nameZh: '已安排接驳',
                    nameEn: 'Arranged transfer',
                    appears: true,
                    feeState: 'ARRANGED',
                  },
                ]
              : [],
        }));
        return {
          title: '独立站人工报价',
          duration: 2,
          startDate: null,
          pax: null,
          arrivalTime: '',
          departureTime: '',
          configVersion: config.version,
          days,
          vehiclePrices: [{ vehicleType: '7_seat', unitPrice: '1288.50' }],
        };
      };
      const createPlan = async (input: WebsiteItineraryInput) => {
        const parent = await data<WebsiteInquiry>(
          await request('GET', `/website/inquiries/${inquiry.id}`, owner),
        );
        return data<WebsiteItinerary>(
          await request(
            'POST',
            `/website/inquiries/${inquiry.id}/itineraries`,
            owner,
            { ...input, inquiryVersion: parent.version },
          ),
          201,
        );
      };
      const preview = async (id: string) =>
        data<WebsitePreview>(
          await request('GET', `/website/itineraries/${id}/preview`, owner),
        );
      const errorScenarios: Array<
        [string, (plan: WebsiteItineraryInput) => void]
      > = [
        [
          'VAL-E01',
          (plan) => {
            plan.days.pop();
          },
        ],
        [
          'VAL-E02',
          (plan) => {
            plan.days[0].overnightCityId = secondCityId;
          },
        ],
        [
          'VAL-E03',
          (plan) => {
            plan.days[0].endCityId = secondCityId;
          },
        ],
        [
          'VAL-E04',
          (plan) => {
            plan.days[0].services[0].feeState = 'UNKNOWN';
          },
        ],
        [
          'VAL-E06',
          (plan) => {
            plan.days[0].hotels[0].nameEn = '';
            plan.days[0].hotels[0].nameZh = '';
          },
        ],
        [
          'VAL-E07',
          (plan) => {
            plan.vehiclePrices[0].unitPrice = null;
          },
        ],
      ];
      for (const [code, mutate] of errorScenarios) {
        const input = planFixture();
        mutate(input);
        const invalidPlan = await createPlan(input);
        const result = await preview(invalidPlan.id);
        assert(
          result.issues.some(
            (issue) => issue.code === code && issue.severity === 'ERROR',
          ),
          `${code}: ${JSON.stringify(result.issues)}`,
        );
        assert.equal(
          (
            await request(
              'POST',
              `/website/itineraries/${invalidPlan.id}/confirm`,
              owner,
              {
                version: invalidPlan.version,
                inquiryVersion: result.inquiryVersion,
                acknowledgedWarnings: [],
              },
            )
          ).status,
          400,
        );
      }
      const missingGuideConfig = structuredClone(config);
      missingGuideConfig.templates = missingGuideConfig.templates.filter(
        (item) => item.code !== 'guide',
      );
      config = await data<WebsiteConfig>(
        await request('PUT', '/website/config', resource, missingGuideConfig),
      );
      const missingGuidePlan = await createPlan(planFixture());
      const guideError = await preview(missingGuidePlan.id);
      assert(
        guideError.issues.some(
          ({ code, severity }) => code === 'VAL-E05' && severity === 'ERROR',
        ),
      );
      config = await data<WebsiteConfig>(
        await request('PUT', '/website/config', resource, {
          ...authoredConfig,
          version: config.version,
        }),
      );

      const attractionFixture = () => ({
        id: randomUUID(),
        attractionId,
        nameZh: '测试湖',
        nameEn: 'Test Lake',
        descriptionZh: '参观{city}的{attraction}。',
        descriptionEn: 'Visit {attraction} in {city}.',
        appears: true,
        feeState: 'INCLUDED' as const,
      });
      for (const warningCode of ['VAL-W01', 'VAL-W02', 'VAL-W03']) {
        const input = planFixture();
        input.days[0].items = [attractionFixture()];
        if (warningCode === 'VAL-W01')
          input.days[1].items = [attractionFixture()];
        if (warningCode === 'VAL-W02') input.startDate = '2026-10-07';
        if (warningCode !== 'VAL-W03') {
          input.arrivalTime = '09:00';
          input.departureTime = '18:00';
        }
        const warningPlan = await createPlan(input);
        const result = await preview(warningPlan.id);
        assert(
          result.issues.some(
            ({ code, severity }) =>
              code === warningCode && severity === 'WARNING',
          ),
          `${warningCode}: ${JSON.stringify(result.issues)}`,
        );
        assert.equal(
          result.issues.filter(({ severity }) => severity === 'ERROR').length,
          0,
        );
      }

      const initialPlan = planFixture();
      assert.equal(
        (
          await request(
            'POST',
            `/website/inquiries/${inquiry.id}/itineraries`,
            owner,
            { ...initialPlan, inquiryVersion: inquiry.version },
          )
        ).status,
        409,
      );
      initialPlan.days = [];
      initialPlan.vehiclePrices = [];
      let itinerary = await createPlan(initialPlan);
      itinerary = await data<WebsiteItinerary>(
        await request(
          'POST',
          `/website/itineraries/${itinerary.id}/generate`,
          owner,
          { version: itinerary.version, skeletonId },
        ),
        201,
      );
      assert.equal(itinerary.days.length, 2);
      assert(itinerary.days.every((day) => day.items.length === 0));
      const savedInput = planFixture();
      savedInput.days[0].items = [
        attractionFixture(),
        {
          id: randomUUID(),
          attractionId: componentId,
          nameZh: '湖区接驳车',
          nameEn: 'Lake shuttle',
          descriptionZh: '湖区接驳车。',
          descriptionEn: 'Lake shuttle experience.',
          appears: true,
          feeState: 'EXCLUDED',
        },
      ];
      itinerary = await data<WebsiteItinerary>(
        await request('PUT', `/website/itineraries/${itinerary.id}`, owner, {
          ...savedInput,
          version: itinerary.version,
        }),
      );
      assert.equal(itinerary.startDate, null);
      assert.equal(itinerary.pax, null);
      assert.equal(
        itinerary.days[0].items[0].id,
        savedInput.days[0].items[0].id,
      );
      assert.equal(itinerary.vehiclePrices[0].unitPrice, '1288.50');
      assert.equal(
        (
          await db.query<Array<{ count: string }>>(
            'SELECT count(*)::text FROM website_days WHERE itinerary_id=$1',
            [itinerary.id],
          )
        )[0].count,
        '2',
      );
      assert.equal(
        (
          await db.query<Array<{ count: string }>>(
            'SELECT count(*)::text FROM website_items WHERE day_id=ANY($1::uuid[])',
            [itinerary.days.map((day) => day.id)],
          )
        )[0].count,
        '2',
      );
      for (const outsider of [linxi, shengxu, resource]) {
        assert.equal(
          (
            await request(
              'GET',
              `/website/itineraries/${itinerary.id}`,
              outsider,
            )
          ).status,
          403,
        );
      }
      assert.equal(
        (await request('GET', `/website/itineraries/${itinerary.id}`, other))
          .status,
        404,
      );
      for (const reader of [headquartersAdmin, executive]) {
        assert.equal(
          (await request('GET', `/website/itineraries/${itinerary.id}`, reader))
            .status,
          200,
        );
        assert.equal(
          (
            await request(
              'PUT',
              `/website/itineraries/${itinerary.id}`,
              reader,
              {},
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await request(
              'POST',
              `/website/itineraries/${itinerary.id}/copy`,
              reader,
              {},
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await request(
              'POST',
              `/website/itineraries/${itinerary.id}/confirm`,
              reader,
              {},
            )
          ).status,
          403,
        );
      }
      const output = await preview(itinerary.id);
      assert(!output.issues.some(({ code }) => code === 'VAL-W02'));
      assert.equal(
        output.issues.filter(({ severity }) => severity === 'ERROR').length,
        0,
        JSON.stringify(output.issues),
      );
      assert.deepEqual(
        output.english.itinerary.map((day) => day.day),
        ['D1', 'D2'],
      );
      assert.deepEqual(output.english.quotation, [
        { vehicle: '7-seat vehicle', price: 'RMB 1288.50 PP' },
      ]);
      assert(
        output.english.inclusions.some((line) => line.includes('Test Lake')),
      );
      assert(output.chinese.inclusions.some((line) => line.includes('测试湖')));
      assert(
        output.english.inclusions.some((line) =>
          line.includes('English guide'),
        ),
      );
      assert(
        !output.english.inclusions.some(
          (line) =>
            line.includes('Lake shuttle') || line.includes('Arranged transfer'),
        ),
      );
      assert.match(
        output.english.itinerary[0].sightseeing,
        /Lake shuttle.*not included/,
      );
      assert.match(
        output.english.itinerary[0].sightseeing,
        /Manual Restaurant recommended/,
      );
      assert.match(
        output.english.itinerary[0].sightseeing,
        /Visit Test Lake in Kunming\./,
      );
      assert.match(
        output.chinese.itinerary[0].sightseeing,
        /参观昆明的测试湖。/,
      );
      assert(!output.english.itinerary[0].sightseeing.includes('{attraction}'));
      assert(!output.chinese.itinerary[0].sightseeing.includes('{city}'));
      assert(!output.english.itinerary[1].sightseeing.includes('guide'));
      assert.equal(output.english.notes.length, 3);
      assert.equal(output.chinese.notes.length, 3);
      assert(
        !JSON.stringify(output.english).includes(inquiryInput.internalRemark),
      );
      const monthBoundaryPlan = structuredClone(itinerary);
      monthBoundaryPlan.startDate = '2026-02-28';
      monthBoundaryPlan.arrivalTime = '09:00';
      monthBoundaryPlan.departureTime = '18:00';
      monthBoundaryPlan.days[0].items = [];
      monthBoundaryPlan.days[1].items = [attractionFixture()];
      const monthBoundaryConfig = structuredClone(config);
      monthBoundaryConfig.attractions.find(
        (item) => item.id === attractionId,
      )!.recommendedMonths = [3];
      const monthBoundary = buildWebsitePreview(
        inquiry,
        monthBoundaryPlan,
        monthBoundaryConfig,
      );
      assert.equal(monthBoundary.english.itinerary[1].day, '2026-03-01');
      assert(!monthBoundary.issues.some(({ code }) => code === 'VAL-W02'));
      const repeatedHotelPlan = structuredClone(itinerary);
      repeatedHotelPlan.duration = 3;
      const thirdDay = structuredClone(repeatedHotelPlan.days[1]);
      thirdDay.id = randomUUID();
      thirdDay.dayNumber = 3;
      thirdDay.meals = thirdDay.meals.map((meal) => ({
        ...meal,
        id: randomUUID(),
      }));
      repeatedHotelPlan.days[1].overnightCityId = cityId;
      repeatedHotelPlan.days[1].hotels = repeatedHotelPlan.days[0].hotels.map(
        (hotel) => ({ ...hotel, id: randomUUID() }),
      );
      repeatedHotelPlan.days.push(thirdDay);
      const repeatedHotelInquiry = { ...inquiry, plannedDays: 3 };
      const repeatedHotelPreview = buildWebsitePreview(
        repeatedHotelInquiry,
        repeatedHotelPlan,
        config,
      );
      assert.equal(repeatedHotelPreview.english.hotelOptions.length, 1);
      assert.equal(repeatedHotelPreview.chinese.hotelOptions.length, 1);
      assert.equal(
        repeatedHotelPreview.english.itinerary[0].hotel,
        repeatedHotelPreview.english.itinerary[1].hotel,
      );
      assert.equal(
        repeatedHotelPreview.issues.filter(
          ({ severity }) => severity === 'ERROR',
        ).length,
        0,
      );
      const noBreakfastPlan = structuredClone(repeatedHotelPlan);
      noBreakfastPlan.days.forEach((day) =>
        day.hotels.forEach((hotel) => {
          hotel.breakfastIncluded = false;
        }),
      );
      const noBreakfastConfig = structuredClone(config);
      noBreakfastConfig.templates = noBreakfastConfig.templates.filter(
        ({ code }) => code !== 'hotel-breakfast',
      );
      const noBreakfastPreview = buildWebsitePreview(
        repeatedHotelInquiry,
        noBreakfastPlan,
        noBreakfastConfig,
      );
      assert.equal(
        noBreakfastPreview.issues.filter(({ severity }) => severity === 'ERROR')
          .length,
        0,
      );
      assert(
        !noBreakfastPreview.english.inclusions.some((line) =>
          /Manual Hotel.*breakfast/.test(line),
        ),
      );
      const explicitlyIncludedPlan = structuredClone(itinerary);
      explicitlyIncludedPlan.days[0].endCityId = secondCityId;
      explicitlyIncludedPlan.days[0].overnightCityId = secondCityId;
      explicitlyIncludedPlan.days[0].hotels.forEach((hotel) => {
        hotel.cityId = secondCityId;
      });
      explicitlyIncludedPlan.days[0].legs = [
        {
          id: randomUUID(),
          routeId: null,
          fromCityId: cityId,
          toCityId: secondCityId,
          mode: 'flight',
          nameZh: '人工明确包含的机票',
          nameEn: 'Explicitly included flight ticket',
          feeState: 'INCLUDED',
        },
      ];
      explicitlyIncludedPlan.days[0].items.find(
        (item) => item.attractionId === componentId,
      )!.feeState = 'INCLUDED';
      explicitlyIncludedPlan.days[1].departCityId = secondCityId;
      explicitlyIncludedPlan.days[1].endCityId = secondCityId;
      const explicitlyIncludedPreview = buildWebsitePreview(
        inquiry,
        explicitlyIncludedPlan,
        config,
      );
      assert.equal(
        explicitlyIncludedPreview.issues.filter(
          ({ severity }) => severity === 'ERROR',
        ).length,
        0,
      );
      assert(
        explicitlyIncludedPreview.english.inclusions.some((line) =>
          line.includes('Explicitly included flight ticket'),
        ),
      );
      assert(
        explicitlyIncludedPreview.chinese.inclusions.some((line) =>
          line.includes('人工明确包含的机票'),
        ),
      );
      assert(
        explicitlyIncludedPreview.english.inclusions.some((line) =>
          line.includes('Lake shuttle'),
        ),
      );
      assert(
        explicitlyIncludedPreview.chinese.inclusions.some((line) =>
          line.includes('湖区接驳车'),
        ),
      );
      assert.match(
        explicitlyIncludedPreview.english.exclusions[0],
        /do not apply.*explicitly listed as included/,
      );
      assert.match(
        explicitlyIncludedPreview.chinese.exclusions[0],
        /明确列入.*包含项.*除外/,
      );
      assert.equal(
        (
          await request(
            'POST',
            `/website/itineraries/${itinerary.id}/confirm`,
            owner,
            {
              version: itinerary.version,
              inquiryVersion: output.inquiryVersion,
              acknowledgedWarnings: [],
            },
          )
        ).status,
        400,
      );
      const acknowledgedWarnings = [
        ...new Set(
          output.issues
            .filter(({ severity }) => severity === 'WARNING')
            .map(({ code }) => code),
        ),
      ];
      const quotation = await data<WebsiteQuotation>(
        await request(
          'POST',
          `/website/itineraries/${itinerary.id}/confirm`,
          owner,
          {
            version: itinerary.version,
            inquiryVersion: output.inquiryVersion,
            acknowledgedWarnings,
          },
        ),
        201,
      );
      assert.deepEqual(quotation.english, output.english);
      assert.deepEqual(quotation.chinese, output.chinese);
      assert.equal(
        (
          await request('PUT', `/website/itineraries/${itinerary.id}`, owner, {
            ...savedInput,
            version: itinerary.version,
          })
        ).status,
        409,
      );
      for (const reader of [headquartersAdmin, executive]) {
        assert.deepEqual(
          await data<WebsiteQuotation>(
            await request(
              'GET',
              `/website/itineraries/${itinerary.id}/quotation`,
              reader,
            ),
          ),
          quotation,
        );
      }
      const changedConfig = structuredClone(config);
      changedConfig.templates.find(
        (item) => item.code === 'private-driver',
      )!.en = 'Changed future vehicle wording.';
      config = await data<WebsiteConfig>(
        await request('PUT', '/website/config', resource, changedConfig),
      );
      assert.deepEqual(
        await data<WebsiteQuotation>(
          await request(
            'GET',
            `/website/itineraries/${itinerary.id}/quotation`,
            owner,
          ),
        ),
        quotation,
      );
      const confirmedItinerary = await data<WebsiteItinerary>(
        await request('GET', `/website/itineraries/${itinerary.id}`, owner),
      );
      const copy = await data<WebsiteItinerary>(
        await request(
          'POST',
          `/website/itineraries/${itinerary.id}/copy`,
          owner,
          { version: confirmedItinerary.version },
        ),
        201,
      );
      assert.notEqual(copy.id, itinerary.id);
      assert.equal(copy.status, 'draft');
      assert.equal(copy.configVersion, itinerary.configVersion);
      assert.notEqual(copy.days[0].id, itinerary.days[0].id);
      assert.notEqual(copy.days[0].items[0].id, itinerary.days[0].items[0].id);
      assert.deepEqual(copy.vehiclePrices, itinerary.vehiclePrices);
      const copyInput = {
        ...savedInput,
        title: '复制后独立修改',
        days: copy.days,
        configVersion: copy.configVersion,
      };
      const updatedCopy = await data<WebsiteItinerary>(
        await request('PUT', `/website/itineraries/${copy.id}`, owner, {
          ...copyInput,
          version: copy.version,
        }),
      );
      assert.equal(updatedCopy.title, '复制后独立修改');
      const outdatedPreview = await preview(updatedCopy.id);
      assert(
        outdatedPreview.issues.some(
          ({ code, severity }) =>
            code === 'CONFIG_VERSION_OUTDATED' && severity === 'ERROR',
        ),
      );
      assert.equal(
        (
          await request(
            'POST',
            `/website/itineraries/${updatedCopy.id}/confirm`,
            owner,
            {
              version: updatedCopy.version,
              inquiryVersion: outdatedPreview.inquiryVersion,
              acknowledgedWarnings,
            },
          )
        ).status,
        409,
      );
      assert.equal(
        (
          await request('PUT', `/website/itineraries/${copy.id}`, owner, {
            ...copyInput,
            version: copy.version,
          })
        ).status,
        409,
      );
      assert.deepEqual(
        await data<WebsiteQuotation>(
          await request(
            'GET',
            `/website/itineraries/${itinerary.id}/quotation`,
            owner,
          ),
        ),
        quotation,
      );

      const impact = await data<{ total: number; unfinished: number }>(
        await request('GET', `/users/${owner.id}/inquiry-impact`, root),
      );
      assert.deepEqual(impact, { total: 1, unfinished: 1 });
      const coordinatorRole = await db
        .getRepository(RoleEntity)
        .findOneByOrFail({ code: 'COORDINATOR' });
      const disableResponse = await request('PUT', `/users/${owner.id}`, root, {
        nickname: owner.nickname,
        avatar: '',
        gender: 0,
        mobile: '',
        email: '',
        status: 0,
        identities: [
          {
            id: owner.identityId,
            scope: 'website',
            deptId: 7,
            roleIds: [coordinatorRole.id],
          },
        ],
      });
      assert.equal(
        disableResponse.status,
        409,
        await disableResponse.clone().text(),
      );
      const disableBody = (await disableResponse.json()) as {
        code: string;
        details: { total: number; unfinished: number };
      };
      assert.equal(disableBody.code, 'INQUIRY_OWNER_INVALID');
      assert.deepEqual(disableBody.details, impact);
      const latestInquiry = await data<WebsiteInquiry>(
        await request('GET', `/website/inquiries/${inquiry.id}`, manager),
      );
      const transferred = await data<WebsiteInquiry>(
        await request(
          'POST',
          `/website/inquiries/${inquiry.id}/transfer`,
          manager,
          {
            version: latestInquiry.version,
            ownerId: other.id,
            reason: '测试转交',
          },
        ),
        201,
      );
      assert.equal(transferred.ownerId, other.id);
      assert.equal(
        (await request('GET', `/website/itineraries/${copy.id}`, owner)).status,
        404,
      );
      assert.equal(
        (await request('GET', `/website/itineraries/${copy.id}`, other)).status,
        200,
      );
      assert.deepEqual(
        await data<{ total: number; unfinished: number }>(
          await request('GET', `/users/${owner.id}/inquiry-impact`, root),
        ),
        { total: 0, unfinished: 0 },
      );
      const lost = await data<WebsiteInquiry>(
        await request('PUT', `/website/inquiries/${inquiry.id}`, other, {
          ...inquiryInput,
          status: 'lost',
          lostReason: '测试结束',
          version: transferred.version,
        }),
      );
      assert.equal(lost.ownerId, other.id);
      assert.equal(
        (
          await request(
            'POST',
            `/website/inquiries/${inquiry.id}/archive`,
            manager,
            { version: lost.version },
          )
        ).status,
        409,
      );
      assert.deepEqual(
        await data<{ total: number; unfinished: number }>(
          await request('GET', `/users/${other.id}/inquiry-impact`, root),
        ),
        { total: 1, unfinished: 0 },
      );
    } finally {
      await app.close();
    }
    assert.deepEqual(await readLegacy(), legacyBefore);
    console.log(
      'PASS: website empty/repeat/upgrade migrations; unchanged Linxi inquiry/itinerary/frozen quote; real HTTP scope and role boundaries; seven errors/three warnings; nullable date/PAX; structured save; bilingual freeze; immutable history; copy/version conflict; owner disable and transfer.',
    );
  } finally {
    if (db?.isInitialized) await db.destroy();
    for (const name of databaseNames)
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.destroy();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
