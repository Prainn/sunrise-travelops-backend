import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter';
import { createValidationException } from '../src/common/validation/validation-exception.factory';
/** Explicitly targets the disposable PostgreSQL container on localhost:55439. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { UserEntity } from '../src/users/user.entity';
import { UserIdentityEntity } from '../src/users/user-identity.entity';
import { RoleEntity } from '../src/roles/role.entity';
import { AuthService } from '../src/auth/auth.service';
import { UserLoginRecordEntity } from '../src/auth/user-login-record.entity';
import { UserManagementService } from '../src/users/user-management.service';
import { InquiriesService } from '../src/inquiries/inquiries.service';
import { calculateItineraryQuote } from '../src/inquiries/quote-pricing';
import { ItineraryValidation } from '../src/inquiries/itinerary-validation';
import { InquiryQuery } from '../src/inquiries/inquiry.dto';
import { ItineraryEntity, PdfData } from '../src/inquiries/inquiry.entity';
import { loadItineraryData } from '../src/inquiries/structured-itinerary';
import { AgenciesService } from '../src/resources/agencies/agencies.service';
import {
  AgencyEntity,
  AgencyContactEntity,
} from '../src/resources/agencies/agency.entity';
import { ResourceValidationService } from '../src/resources/common/resource-validation.service';
import { BusinessDictionaryTypeEntity } from '../src/system/business-dictionaries/business-dictionary-type.entity';
import { BusinessDictionaryItemEntity } from '../src/system/business-dictionaries/business-dictionary-item.entity';
import { CityEntity } from '../src/resources/cities/city.entity';
import { CitiesService } from '../src/resources/cities/cities.service';
import { SelectionService } from '../src/resources/selections/selection.service';
import { withResourceScope } from '../src/resources/common/resource-scope';
import { AuthenticatedUser } from '../src/auth/auth.types';
import type { Request } from 'express';
const connection = {
  type: 'postgres' as const,
  host: '127.0.0.1',
  port: 55439,
  username: 'postgres',
  password: 'isolated-test-only',
};
async function main() {
  const admin = await new DataSource({
    ...connection,
    database: 'travel_refactor_test',
  }).initialize();
  const database = `travel_refactor_check_${Date.now()}`;
  await admin.query(`CREATE DATABASE ${database}`);
  const emptyDatabase = `${database}_empty`;
  await admin.query(`CREATE DATABASE ${emptyDatabase}`);
  await admin.destroy();
  const empty = await new DataSource({
    ...connection,
    database: emptyDatabase,
    entities: [`${__dirname}/../src/**/*.entity.ts`],
    migrations: [`${__dirname}/../src/migrations/*.ts`],
    synchronize: false,
  }).initialize();
  try {
    const migrations = [...empty.migrations];
    empty.migrations.splice(
      0,
      empty.migrations.length,
      ...migrations.filter(
        (m) =>
          Number((m.name ?? m.constructor.name).slice(-13)) < 1789488200000,
      ),
    );
    await empty.runMigrations();
    await empty.query(`INSERT INTO resource_guide_people(library,code,name)
      VALUES ('shengxu','GPR-OLD','旧导游档案')`);
    empty.migrations.splice(0, empty.migrations.length, ...migrations);
    assert(
      (await empty.runMigrations()).some(
        ({ name }) => name === 'AddGuidePersonProfileFields1789488200000',
      ),
    );
    const oldPerson: unknown = await empty.query(`SELECT name, age, contact,
      employment_type, has_labor_contract, remark FROM resource_guide_people
      WHERE code='GPR-OLD'`);
    assert.deepEqual(oldPerson, [
      {
        name: '旧导游档案',
        age: null,
        contact: null,
        employment_type: null,
        has_labor_contract: null,
        remark: null,
      },
    ]);
    assert.equal((await empty.runMigrations()).length, 0);
  } finally {
    await empty.destroy();
  }
  const db = await new DataSource({
    ...connection,
    database,
    entities: [`${__dirname}/../src/**/*.entity.ts`],
    migrations: [`${__dirname}/../src/migrations/*.ts`],
    synchronize: false,
  }).initialize();
  try {
    const all = [...db.migrations];
    db.migrations.splice(
      0,
      db.migrations.length,
      ...all.filter(
        (m) =>
          Number((m.name ?? m.constructor.name).slice(-13)) < 1789459200000,
      ),
    );
    await db.runMigrations();
    const ids = Object.fromEntries(
      [
        'root',
        'owner',
        'other',
        'agency',
        'contact',
        'hotel',
        'vehicle',
        'guide',
        'draft',
        'quoted',
        'inquiry',
        'quote',
      ].map((k) => [k, randomUUID()]),
    );
    const passwordHash = await argon2.hash('legacy-password');
    for (const [key, username, dept, role] of [
      ['root', 'sunrise', 1, 'ROOT'],
      ['owner', 'houyue', 3, 'COORDINATOR'],
      ['other', 'second', 3, 'COORDINATOR'],
    ] as const) {
      await db.query(
        'INSERT INTO users(id,username,nickname,password_hash,dept_id) VALUES($1,$2,$2,$3,$4)',
        [ids[key], username, passwordHash, dept],
      );
      await db.query(
        'INSERT INTO roles(code,name) VALUES($1,$1) ON CONFLICT DO NOTHING',
        [role],
      );
      await db.query(
        'INSERT INTO user_roles SELECT $1,id FROM roles WHERE code=$2',
        [ids[key], role],
      );
    }

    await db.query(
      "INSERT INTO resource_agencies(id,code,name) VALUES($1,'AGY-001','历史旅行社')",
      [ids.agency],
    );
    await db.query(
      "INSERT INTO resource_agency_contacts(id,agency_id,name,name_key) VALUES($1,$2,'联系人','联系人')",
      [ids.contact, ids.agency],
    );
    await db.query(
      "INSERT INTO resource_hotels(id,code,name,city,rating,individual_price,unit) VALUES($1,'HTL-001','历史酒店','昆明','international_five_star',900,'roomNight')",
      [ids.hotel],
    );
    await db.query(
      "INSERT INTO resource_transports(id,code,name,seats,service_level,unit) VALUES($1,'VEH-001','历史车型',50,'standard','vehicleDay')",
      [ids.vehicle],
    );
    await db.query(
      "INSERT INTO resource_guides(id,code,name,daily_price,second_language,shopping) VALUES($1,'GDE-001','历史导游',800,'en',false)",
      [ids.guide],
    );
    const inquiryData = {
      agencyId: ids.agency,
      contactId: ids.contact,
      agencyCode: 'AGY-001',
      agencyName: '历史旅行社',
      contactName: '联系人',
      email: '',
      phone: '',
      countryOrRegion: '',
      sourceChannel: 'Email',
      originalMessage: '保留原始消息\n第二行',
      internalRemark: '内部备注',
      plannedDays: 3,
      nextFollowUpAt: null,
      lostReason: '',
    };
    await db.query(
      "INSERT INTO inquiries(id,code,owner_id,owner,status,creator,data) VALUES($1,'INQ-20260901-01',$2,'侯悦','quoted','houyue',$3)",
      [ids.inquiry, ids.owner, inquiryData],
    );
    const plan = {
      title: '历史方案',
      startDate: '2026-09-14',
      adults: 8,
      childrenCount: 2,
      leaderCount: 1,
      destinations: ['昆明'],
      dailyPlans: [0, 1, 2].map((n) => ({
        id: `day-${n}`,
        dayNumber: n + 1,
        date: `2026-09-${14 + n}`,
        departure: '机场',
        destination: '昆明',
        overnightDestination: n === 2 ? '' : '昆明',
        meals: { breakfast: n > 0, lunch: true, dinner: false },
        transport: 'bus',
        description: '原有日程',
        items: [
          {
            id: `meal-${n}`,
            type: 'restaurant',
            resourceId: null,
            resourcePriceId: null,
            resourceName: '历史自定义餐厅',
            priceName: '',
            quantity: 11,
            unit: 'personMeal',
            unitCost: 85.12,
            totalCost: 936.32,
            remark: '内部餐食备注',
            mealSlot: 'lunch',
          },
        ],
      })),
      hotelPlans: [
        {
          tier: 'international_five_star',
          hotels: [
            {
              destination: '昆明',
              hotelId: ids.hotel,
              hotelName: '历史名称酒店',
              rating: 'international_five_star',
              breakfast: '早餐',
              unit: 'roomNight',
              unitCost: 555.55,
            },
          ],
        },
      ],
      vehiclePlans: [
        {
          tier: 'standard',
          totalPrice: 1234.56,
          arrangements: [
            {
              id: 'range-a',
              startDate: '2026-09-14',
              endDate: '2026-09-14',
              totalPrice: 234.56,
              vehicles: [
                {
                  vehicleId: ids.vehicle,
                  vehicleName: '历史车辆名称',
                  seats: 40,
                  quantity: 1,
                },
              ],
            },
            {
              id: 'range-b',
              startDate: '2026-09-16',
              endDate: '2026-09-16',
              totalPrice: null,
              vehicles: [
                {
                  vehicleId: ids.vehicle,
                  vehicleName: '历史车辆名称',
                  seats: 40,
                  quantity: 1,
                },
              ],
            },
          ],
        },
      ],
      guidePlans: [
        {
          destination: '昆明',
          guideId: ids.guide,
          guideName: '历史导游名称',
          secondLanguage: 'en',
          shopping: false,
          dailyPrice: 333.33,
          serviceDays: 3,
        },
      ],
      quote: {
        customerNotes: '',
        holidayRestrictions: '',
        hotelReplacementTerms: '如所列酒店满房，将调整为同级酒店。',
        chineseTip: 200,
        englishTip: null,
        otherExpenses: 500,
        options: [
          {
            id: 'option-old',
            hotelTier: 'international_five_star',
            vehicleTier: 'standard',
            adultUnitPrice: 2000,
            leaderFocEnabled: false,
          },
        ],
        transportFees: [
          {
            id: 'fee-old',
            type: 'flight',
            departureCity: '昆明',
            arrivalCity: '上海',
            cabin: 'economy',
            unitPrice: 123.45,
          },
        ],
      },
    };
    for (const key of ['draft', 'quoted'])
      await db.query(
        'INSERT INTO itineraries(id,inquiry_id,code,status,creator,data) VALUES($1,$2,$3,$4,$5,$6)',
        [
          ids[key],
          ids.inquiry,
          `ITI-20260901-0${key === 'draft' ? 1 : 2}`,
          key === 'draft' ? 'draft' : 'quoted',
          'houyue',
          plan,
        ],
      );
    const snapshot = {
      inquiry: {
        ...inquiryData,
        id: ids.inquiry,
        code: 'INQ-20260901-01',
        ownerId: ids.owner,
        owner: '侯悦',
        status: 'quoted',
        creator: 'houyue',
        createdAt: '2026-09-01T00:00:00Z',
        updatedAt: '2026-09-01T00:00:00Z',
        version: 1,
      },
      itinerary: {
        ...plan,
        id: ids.quoted,
        inquiryId: ids.inquiry,
        code: 'ITI-20260901-02',
        status: 'quoted',
        creator: 'houyue',
        version: 1,
        createdAt: '2026-09-01T00:00:00Z',
        updatedAt: '2026-09-01T00:00:00Z',
        endDate: '2026-09-16',
        days: 3,
        quoteGeneratedAt: '2026-09-01T00:00:00Z',
      },
      inquiryVersion: 1,
      generatedAt: '2026-09-01T00:00:00Z',
      quoteCode: 'ITI-20260901-02-V1',
      quoteVersion: 1,
      // Frozen pre-PAX calculation: migration fixtures must not use current pricing.
      calculation: {
        hotelGuestCount: 11,
        hotelRoomCount: 6,
        dailyResourceCost: 2808.96,
        guideCost: 999.99,
        options: [
          {
            optionId: 'option-old',
            hotelTier: 'international_five_star',
            vehicleTier: 'standard',
            hotelCost: 6666.6,
            vehicleCost: 1234.56,
            commonGroupCost: 5043.51,
            baseGroupCost: 11710.11,
            baseCostPerPerson: 1245.76,
            singleSupplementUnitCost: 555.55,
            adultUnitPrice: 2000,
            childUnitPrice: 1400,
            totalPrice: 18800,
            profit: 7089.89,
            actualMarginRate: 37.71,
            lines: [
              {
                type: 'adult',
                quantity: 8,
                unitPrice: 2000,
                totalPrice: 16000,
              },
              { type: 'child', quantity: 2, unitPrice: 1400, totalPrice: 2800 },
            ],
          },
        ],
      },
    } as PdfData;
    snapshot.calculation.options[0].profit = -12.34;
    await db.query(
      'INSERT INTO itinerary_quotes(id,itinerary_id,source_version,created_by,snapshot) VALUES($1,$2,1,$3,$4)',
      [ids.quote, ids.quoted, ids.owner, snapshot],
    );
    db.migrations.splice(0, db.migrations.length, ...all);
    await db.query(
      'UPDATE itineraries SET data=data || \'{"unmappedLegacyField":1}\'::jsonb WHERE id=$1',
      [ids.draft],
    );
    await assert.rejects(
      db.runMigrations(),
      /Unmapped fields.*unmappedLegacyField/,
    );
    assert.equal(
      (
        await db.query<Array<{ n: number }>>(
          "SELECT count(*)::int n FROM information_schema.columns WHERE table_name='itineraries' AND column_name='data'",
        )
      )[0].n,
      1,
    );
    await db.query(
      "UPDATE itineraries SET data=data-'unmappedLegacyField' WHERE id=$1",
      [ids.draft],
    );
    db.migrations.splice(
      0,
      db.migrations.length,
      ...all.filter(
        (m) =>
          Number((m.name ?? m.constructor.name).slice(-13)) < 1790006500000,
      ),
    );
    await db.runMigrations();
    await db.query(
      'UPDATE itinerary_quote_options SET staff_room_total=1040 WHERE itinerary_id=$1',
      [ids.draft],
    );
    db.migrations.splice(
      0,
      db.migrations.length,
      ...all.filter(
        (m) =>
          Number((m.name ?? m.constructor.name).slice(-13)) < 1790006600000,
      ),
    );
    await db.runMigrations();
    await db.query(
      `INSERT INTO itinerary_quote_options(itinerary_id,position,id,hotel_tier,vehicle_tier,guide_service_total,staff_room_total)
      SELECT itinerary_id,1,'option-vip',hotel_tier,'vip',guide_service_total+1,staff_room_total
      FROM itinerary_quote_options WHERE itinerary_id=$1`,
      [ids.draft],
    );
    db.migrations.splice(0, db.migrations.length, ...all);
    await assert.rejects(db.runMigrations(), /Conflicting shared staff costs/);
    await db.query(
      `UPDATE itinerary_quote_options SET guide_service_total=1499.99 WHERE itinerary_id=$1`,
      [ids.draft],
    );
    // Missing city cost on one option is zero, not an implicit copy of the other.
    await assert.rejects(db.runMigrations(), /Conflicting shared staff costs/);
    await db.query(
      `INSERT INTO itinerary_staff_room_costs(itinerary_id,option_id,position,destination,total)
      SELECT itinerary_id,'option-vip',position,destination,total FROM itinerary_staff_room_costs
      WHERE itinerary_id=$1 AND option_id='option-old'`,
      [ids.draft],
    );
    assert(
      (await db.runMigrations()).some(
        ({ name }) => name === 'ShareItineraryStaffCosts1790006600000',
      ),
    );
    // Leave the representative plan with its original hotel/vehicle combination.
    await db.query(
      `DELETE FROM itinerary_quote_options WHERE itinerary_id=$1 AND id='option-vip'`,
      [ids.draft],
    );
    assert.equal((await db.runMigrations()).length, 0);
    const migrated = await loadItineraryData(
      db.manager,
      await db.manager.findOneByOrFail(ItineraryEntity, { id: ids.draft }),
    );
    // Keep the migrated legacy snapshot for migration assertions. New saves must
    // submit one use per person and distinct custom restaurant names.
    const editablePlan = structuredClone(migrated.data);
    editablePlan.dailyPlans.forEach((day, index) => {
      day.items.forEach((item) => {
        item.quantity = 1;
        item.totalCost = item.unitCost;
        if (!item.resourceId) {
          item.resourceName = `历史自定义餐厅-${index + 1}`;
          item.adjustmentReason = '历史自定义餐';
        }
      });
    });
    const pricingPlan = structuredClone(migrated.data);
    pricingPlan.paxTiers = [10, 20];
    pricingPlan.guidePlans[0].dailyPrice = 1000;
    pricingPlan.guidePlans[0].serviceDays = 1;
    pricingPlan.quote.staffRoomCosts = [{ destination: '昆明', total: 400 }];
    pricingPlan.quote.paxOtherCosts = [
      {
        pax: 10,
        guideOtherCost: 200,
        guideOtherReason: '导游其它费用',
        staffRoomOtherCost: 100,
        staffRoomOtherReason: '司陪房其它费用',
      },
      {
        pax: 20,
        guideOtherCost: null,
        guideOtherReason: '',
        staffRoomOtherCost: null,
        staffRoomOtherReason: '',
      },
    ];
    pricingPlan.quote.options[0].paxPrices = [];
    pricingPlan.quote.options.push({
      ...pricingPlan.quote.options[0],
      id: 'vip',
      vehicleTier: 'vip',
    });
    pricingPlan.vehiclePlans.push({
      ...pricingPlan.vehiclePlans[0],
      tier: 'vip',
      totalPrice: 2234.56,
    });
    pricingPlan.dailyPlans.forEach((day) => {
      day.items = [];
    });
    const meal = {
      ...migrated.data.dailyPlans[0].items[0],
      unit: 'table',
      unitCost: 100.01,
      dinerCount: 3,
      quantity: 2,
    };
    pricingPlan.dailyPlans[0].items = [
      meal,
      {
        ...meal,
        id: 'attraction',
        type: 'attraction',
        unit: 'ticket',
        unitCost: 25.555,
        dinerCount: null,
      },
    ];
    const costs = calculateItineraryQuote(pricingPlan);
    assert.equal(costs.mealCost, 66.68);
    assert.equal(costs.attractionCost, 51.12);
    assert.equal(costs.dailyResourceCost, 117.8);
    assert.equal(costs.guideCost, 1000);
    assert(costs.options.every((option) => option.staffRoomTotal === 400));
    assert.deepEqual(
      costs.options.map((option) =>
        option.paxPrices.map((row) => [
          row.guideServiceUnitCost,
          row.staffRoomUnitCost,
        ]),
      ),
      [
        [
          [300, 140],
          [50, 20],
        ],
        [
          [300, 140],
          [50, 20],
        ],
      ],
    );
    assert.deepEqual(
      costs.options.map((option) =>
        option.paxPrices.map((row) => row.baseCostPerPerson),
      ),
      [
        [1236.81, 805.08],
        [1336.81, 855.08],
      ],
    );
    pricingPlan.guidePlans = [];
    pricingPlan.quote.staffRoomCosts[0].total = null;
    pricingPlan.quote.paxOtherCosts = [];
    assert(
      calculateItineraryQuote(pricingPlan).options.every((option) =>
        option.paxPrices.every(
          (row) =>
            row.guideServiceUnitCost === 0 && row.staffRoomUnitCost === 0,
        ),
      ),
    );
    assert.equal(migrated.data.hotelPlans[0].hotels[0].unitCost, 555.55);
    assert.equal(migrated.data.hotelPlans[0].hotels[0].referencePrice, null);
    assert.deepEqual(
      migrated.data.quote.staffRoomCosts.map((cost) => ({
        ...cost,
      })),
      [{ destination: '昆明', total: 1040 }],
    );
    assert.deepEqual(
      migrated.data.vehiclePlans[0].arrangements.map((a) => [
        a.id,
        a.startDate,
        a.endDate,
        a.totalPrice,
      ]),
      plan.vehiclePlans[0].arrangements.map((a) => [
        a.id,
        a.startDate,
        a.endDate,
        a.totalPrice,
      ]),
    );
    assert.deepEqual(
      (
        await db.query<Array<{ snapshot: PdfData }>>(
          'SELECT snapshot FROM itinerary_quotes WHERE id=$1',
          [ids.quote],
        )
      )[0].snapshot,
      snapshot,
    );
    assert.equal(
      (
        await db.query<Array<{ expected_profit: string }>>(
          'SELECT expected_profit FROM quote_options WHERE quote_id=$1',
          [ids.quote],
        )
      )[0].expected_profit,
      '-12.34',
    );
    assert.equal(
      (
        await db.query<Array<{ n: number }>>(
          "SELECT count(*)::int n FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('inquiries','itineraries') AND column_name='data'",
        )
      )[0].n,
      0,
    );
    const frozenRanges = await db.query<
      Array<{ range_id: string; start_date: string; end_date: string }>
    >(
      'SELECT range_id,start_date,end_date FROM quote_vehicle_ranges WHERE quote_id=$1 ORDER BY position',
      [ids.quote],
    );
    assert.deepEqual(
      frozenRanges.map((r) => [r.range_id, r.start_date, r.end_date]),
      plan.vehiclePlans[0].arrangements.map((r) => [
        r.id,
        r.startDate,
        r.endDate,
      ]),
    );
    const auth = new AuthService(
      db.getRepository(UserEntity),
      new JwtService(),
      new ConfigService({
        JWT_SECRET: 'isolated-access-signing-key',
        REFRESH_TOKEN_SECRET: 'isolated-refresh-signing-key',
        JWT_EXPIRES_IN: '15m',
        REFRESH_TOKEN_EXPIRES_IN: '7d',
      }),
      db.getRepository(UserLoginRecordEntity),
    );
    const current = async (
      id: string,
      scope: 'headquarters' | 'shengxu' | 'linxi' | 'website',
    ) => {
      const identity = await db.manager.findOneByOrFail(UserIdentityEntity, {
        userId: id,
        scope,
      });
      return auth.getCurrentUser(id, identity.id, scope);
    };
    const root = await current(ids.root, 'headquarters');
    const owner = await current(ids.owner, 'shengxu');
    const other = await current(ids.other, 'shengxu');
    const management = new UserManagementService(
      db.getRepository(UserEntity),
      db.getRepository(RoleEntity),
      db,
    );
    const role = async (code: string) =>
      (await db.manager.findOneByOrFail(RoleEntity, { code })).id;
    const createUser = async (
      username: string,
      scope: 'headquarters' | 'shengxu' | 'linxi' | 'website',
      deptId: number,
      code: string,
    ) =>
      management.create(
        {
          username,
          password: 'other-password',
          nickname: username,
          avatar: '',
          gender: 0,
          mobile: '',
          email: '',
          status: 1,
          identities: [{ scope, deptId, roleIds: [await role(code)] }],
        },
        root,
      );
    const lx = await createUser('houyue', 'linxi', 5, 'COORDINATOR');
    await assert.rejects(createUser('houyue', 'linxi', 5, 'COORDINATOR'), {
      code: '23505',
    });
    const manager = await createUser(
      'manager',
      'shengxu',
      3,
      'BUSINESS_MANAGER',
    );
    const adminUser = await createUser('sysadmin', 'headquarters', 1, 'ADMIN');
    const exec = await management.create(
      {
        username: 'boss',
        password: 'other-password',
        nickname: '总经理',
        avatar: '',
        gender: 0,
        mobile: '',
        email: '',
        status: 1,
        identities: [
          {
            scope: 'headquarters',
            deptId: 4,
            roleIds: [await role('EXECUTIVE')],
          },
          { scope: 'linxi', deptId: 5, roleIds: [await role('COORDINATOR')] },
        ],
      },
      root,
    );
    const system = await current(adminUser.id, 'headquarters');
    const executive = await current(exec.id, 'headquarters');
    assert(!executive.permissions.includes('inquiry:update'));
    assert(
      (await current(exec.id, 'linxi')).permissions.includes('inquiry:update'),
    );
    await assert.rejects(
      auth.login(
        'houyue',
        'legacy-password',
        { ip: '', userAgent: '' },
        'linxi',
      ),
    );
    const tokens = await auth.login(
      'houyue',
      'other-password',
      { ip: '', userAgent: '' },
      'linxi',
    );
    const renewed = await auth.refresh(tokens.refreshToken);
    const decoded = new JwtService().decode<{ scope: string; sub: string }>(
      renewed.accessToken,
    );
    assert.equal(decoded.scope, 'linxi');
    assert.equal(decoded.sub, lx.id);
    const validation = new ItineraryValidation();
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
    const service = new InquiriesService(db, validation, agencies);
    const actor = async (user: AuthenticatedUser) =>
      service.actor(user, { ip: '127.0.0.1' } as Request);
    const a = await actor(owner),
      b = await actor(other),
      sys = await actor(system),
      boss = await actor(executive),
      head = await actor(await current(manager.id, 'shengxu'));
    assert.equal((await service.list(new InquiryQuery(), b)).total, 0);
    await assert.rejects(service.detail(ids.inquiry, b));
    await assert.rejects(
      service.detail(ids.inquiry, await actor(await current(lx.id, 'linxi'))),
    );
    for (const reader of [sys, boss]) {
      assert.equal((await service.list(new InquiryQuery(), reader)).total, 1);
      await assert.rejects(
        service.copy(ids.draft, { version: 1, title: 'blocked' }, reader),
      );
      await assert.rejects(
        service.saveItinerary(
          ids.draft,
          { ...migrated.data, version: 1 },
          reader,
        ),
      );
      await assert.rejects(
        service.confirmPdf(
          ids.quoted,
          { version: 1, inquiryVersion: 1 },
          reader,
        ),
      );
      assert.deepEqual(await service.pdfData(ids.quoted, reader), snapshot);
    }
    await assert.rejects(management.getFormData(ids.root, system));
    await assert.rejects(
      management.resetPassword(ids.root, 'bad-password', system),
    );
    assert.deepEqual(await management.inquiryImpact(ids.owner, head), {
      total: 1,
      unfinished: 1,
    });
    const userForm = await management.getFormData(ids.owner, head);
    await assert.rejects(
      management.update(
        ids.owner,
        {
          ...userForm,
          identities: userForm.identities.map((i) => ({
            ...i,
            deptId: i.deptId!,
          })),
          status: 0,
        },
        head,
      ),
    );
    const beforeHistory = (
      await db.query<Array<{ n: number }>>(
        'SELECT count(*)::int n FROM itinerary_price_adjustments',
      )
    )[0].n;
    const changed = structuredClone(editablePlan);
    changed.dailyPlans[0].items[0].unitCost = 90;
    changed.dailyPlans[0].items[0].adjustmentReason = '';
    await assert.rejects(
      service.saveItinerary(ids.draft, { ...changed, version: 1 }, a),
    );
    assert.equal(
      (
        await db.query<Array<{ n: number }>>(
          'SELECT count(*)::int n FROM itinerary_price_adjustments',
        )
      )[0].n,
      beforeHistory,
    );
    changed.dailyPlans[0].items[0].adjustmentReason = '供应商调价';
    await db.query(
      "ALTER TABLE inquiry_logs ADD CONSTRAINT reject_saved_log CHECK(action<>'itinerary_saved') NOT VALID",
    );
    await assert.rejects(
      service.saveItinerary(ids.draft, { ...changed, version: 1 }, a),
      { code: '23514' },
    );
    assert.equal(
      (
        await db.query<Array<{ n: number }>>(
          'SELECT count(*)::int n FROM itinerary_price_adjustments',
        )
      )[0].n,
      beforeHistory,
    );
    assert.equal((await service.itinerary(ids.draft, a)).version, 1);
    assert.equal(
      (await service.itinerary(ids.draft, a)).dailyPlans[0].items[0].unitCost,
      85.12,
    );
    await db.query('ALTER TABLE inquiry_logs DROP CONSTRAINT reject_saved_log');
    let saved = await service.saveItinerary(
      ids.draft,
      { ...changed, version: 1 },
      a,
    );
    assert.equal(saved.dailyPlans[0].items[0].unitCost, 90);
    assert.equal(saved.hotelPlans[0].hotels[0].unitCost, 555.55);
    assert.equal(
      (
        await db.query<Array<{ total: string }>>(
          'SELECT total FROM itinerary_shared_staff_room_costs WHERE itinerary_id=$1',
          [ids.draft],
        )
      )[0].total,
      '1040',
    );
    assert.equal(
      (await service.priceAdjustments(ids.draft, a)).length,
      beforeHistory + 1,
    );
    const priorVersion = saved.version;
    const second = structuredClone(saved);
    second.dailyPlans[0].description = '同一账号再次保存明细';
    saved = await service.saveItinerary(
      ids.draft,
      { ...second, version: priorVersion },
      a,
    );
    assert.equal(saved.version, priorVersion + 1);
    await assert.rejects(
      service.saveItinerary(ids.draft, { ...second, version: priorVersion }, a),
      { code: 'ITINERARY_VERSION_CONFLICT' },
    );
    assert.equal(
      (await service.priceAdjustments(ids.draft, a)).length,
      beforeHistory + 1,
    );
    const copy = await service.copy(
      ids.draft,
      { version: saved.version, title: '复制' },
      a,
    );
    assert.equal(copy.hotelPlans[0].hotels[0].referencePrice, null);
    assert.equal(copy.dailyPlans[0].items[0].adjustmentReason, '供应商调价');
    const frozen = await service.confirmPdf(
      ids.draft,
      {
        version: saved.version,
        inquiryVersion: (await service.detail(ids.inquiry, a)).version,
      },
      a,
    );
    assert.equal(frozen.itinerary.dailyPlans[0].items[0].unitCost, 90);
    assert.equal(
      (
        await db.query<Array<{ n: number }>>(
          'SELECT count(*)::int n FROM quote_options WHERE quote_id IN (SELECT id FROM itinerary_quotes WHERE itinerary_id=$1)',
          [ids.draft],
        )
      )[0].n,
      1,
    );
    const transferred = await service.transfer(
      ids.inquiry,
      {
        version: (await service.detail(ids.inquiry, a)).version,
        ownerId: ids.other,
        reason: '人员交接',
      },
      head,
    );
    await assert.rejects(service.itinerary(ids.quoted, a));
    assert.equal((await service.itinerary(ids.quoted, b)).id, ids.quoted);
    await management.update(
      ids.owner,
      {
        ...userForm,
        identities: userForm.identities.map((i) => ({
          ...i,
          deptId: i.deptId!,
        })),
        status: 0,
      },
      head,
    );
    assert.equal((await service.transfers(ids.inquiry, b)).length, 1);
    assert.equal(transferred.businessUnit, 'shengxu');
    const cities = new CitiesService(db.getRepository(CityEntity), db);
    const lxActor = await current(lx.id, 'linxi');
    await withResourceScope(root, 'shared', () =>
      cities.create(
        { name: '昆明', province: '云南', status: 'enabled' as never },
        root.id,
      ),
    );
    const shared = await withResourceScope(lxActor, null, () =>
      cities.options(),
    );
    assert.equal(shared.length, 1);
    assert.equal(shared[0].library, 'shared');
    assert.match(shared[0].code, /^CITY-\d+$/);
    const selection = new SelectionService(db);
    assert.equal(
      (
        await withResourceScope(lxActor, null, () =>
          selection.resources('hotels', { page: 1, pageSize: 20 }),
        )
      ).total,
      0,
    );
    await assert.rejects(
      withResourceScope(lxActor, null, () => agencies.get(ids.agency)),
    );
    await assert.rejects(
      validation.normalize(db.manager, editablePlan, undefined, 3, 'shared'),
    );
    for (const day of editablePlan.dailyPlans)
      for (const item of day.items)
        if (!item.resourceId) item.adjustmentReason = '历史自定义餐';
    const normalized = await validation.normalize(
      db.manager,
      {
        ...editablePlan,
        hotelPlans: [
          {
            ...migrated.data.hotelPlans[0],
            hotels: [
              {
                ...migrated.data.hotelPlans[0].hotels[0],
                unitCost: 900,
                referenceBasis: 'hotel_individual',
              },
            ],
          },
        ],
        guidePlans: [],
        vehiclePlans: [],
        dailyPlans: editablePlan.dailyPlans,
      },
      undefined,
      3,
      'shengxu',
    );
    assert.equal(normalized.hotelPlans[0].hotels[0].referencePrice, 900);
    const priceChange = structuredClone(normalized);
    priceChange.hotelPlans[0].hotels[0].unitCost = 950;
    priceChange.hotelPlans[0].hotels[0].referencePrice = 950;
    await assert.rejects(
      validation.normalize(db.manager, priceChange, normalized, 3, 'shengxu'),
    );
    priceChange.hotelPlans[0].hotels[0].adjustmentReason = '旺季价格';
    const adjusted = await validation.normalize(
      db.manager,
      priceChange,
      normalized,
      3,
      'shengxu',
    );
    assert.equal(adjusted.hotelPlans[0].hotels[0].referencePrice, 900);
    priceChange.hotelPlans[0].hotels[0].unitCost = 900;
    priceChange.hotelPlans[0].hotels[0].adjustmentReason = '';
    await assert.rejects(
      validation.normalize(db.manager, priceChange, adjusted, 3, 'shengxu'),
    );
    priceChange.hotelPlans[0].hotels[0].adjustmentReason = '恢复参考价';
    assert.equal(
      (
        await validation.normalize(
          db.manager,
          priceChange,
          adjusted,
          3,
          'shengxu',
        )
      ).hotelPlans[0].hotels[0].unitCost,
      900,
    );
    // Real controller/guard/interceptor integration against the same disposable database.
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
      JWT_SECRET: 'isolated-http-access-secret-at-least-32-chars',
      REFRESH_TOKEN_SECRET: 'isolated-http-refresh-secret-at-least-32-chars',
      JWT_EXPIRES_IN: '15m',
      REFRESH_TOKEN_EXPIRES_IN: '7d',
      WHATSAPP_RESOLVER_TOKEN: 'isolated-http-resolver-token-at-least-32-chars',
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
        user: AuthenticatedUser,
        body?: unknown,
      ) => {
        const access = await new JwtService().signAsync(
          {
            sub: user.id,
            identityId: user.identityId,
            scope: user.scope,
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
      const httpData = async <T>(response: Response) => {
        assert.equal(response.status, 200, await response.clone().text());
        return ((await response.json()) as { data: T }).data;
      };
      for (const reader of [system, executive]) {
        assert.equal(
          (await request('POST', '/inquiries', reader, {})).status,
          403,
        );
        assert.equal(
          (await request('PUT', `/inquiries/${ids.inquiry}`, reader, {}))
            .status,
          403,
        );
        assert.equal(
          (await request('POST', `/itineraries/${copy.id}/copy`, reader, {}))
            .status,
          403,
        );
        assert.equal(
          (await request('PUT', `/itineraries/${copy.id}`, reader, {})).status,
          403,
        );
        assert.equal(
          (
            await request(
              'POST',
              `/itineraries/${ids.quoted}/confirm-pdf`,
              reader,
              {},
            )
          ).status,
          403,
        );
        assert.equal(
          (await request('GET', `/itineraries/${ids.quoted}/pdf-data`, reader))
            .status,
          200,
        );
      }
      assert.equal(
        (await request('POST', '/users', executive, {})).status,
        403,
      );
      assert.equal(
        (await request('POST', '/resources/hotels', executive, {})).status,
        403,
      );
      assert.equal(
        (await request('GET', `/users/${ids.root}`, system)).status,
        404,
      );
      assert.equal(
        (
          await request('POST', `/users/${ids.root}/reset-password`, system, {
            password: 'attempt-123456',
          })
        ).status,
        404,
      );
      const resourceUser = await createUser(
        'shared-resources',
        'website',
        8,
        'RESOURCE_MANAGER',
      );
      const websiteResources = await current(resourceUser.id, 'website');
      const guidePriceBefore = await httpData<{
        id: string;
        dailyPrice: string;
      }>(await request('GET', `/resources/guides/${ids.guide}`, root));
      const frozenBefore: unknown = await db.query(
        'SELECT snapshot FROM itinerary_quotes WHERE itinerary_id=$1',
        [ids.quoted],
      );
      assert.equal(
        (
          await httpData<{ total: number }>(
            await request('GET', '/resources/guide-people', root),
          )
        ).total,
        0,
      );
      const personInput = {
        library: 'shengxu',
        name: '测试导游',
        age: 36,
        contact: '微信: guide-01',
        employmentType: 'part_time',
        hasLaborContract: false,
        remark: '可周末接团',
        certificateNo: '00123x',
        identityNumber: '临时编号-A01',
        status: 'enabled',
      };
      const personCreate = await request(
        'POST',
        '/resources/guide-people',
        root,
        personInput,
      );
      assert.equal(personCreate.status, 201, await personCreate.clone().text());
      const person = (
        (await personCreate.json()) as {
          data: {
            id: string;
            version: number;
            gender: number;
            age: number | null;
            contact: string | null;
            employmentType: string | null;
            hasLaborContract: boolean | null;
            remark: string | null;
            certificateNo: string | null;
            identityNumber: string | null;
          };
        }
      ).data;
      assert.equal(person.gender, 0);
      assert.equal(person.age, 36);
      assert.equal(person.contact, '微信: guide-01');
      assert.equal(person.employmentType, 'part_time');
      assert.equal(person.hasLaborContract, false);
      assert.equal(person.remark, '可周末接团');
      assert.equal(person.certificateNo, '00123x');
      assert.equal(person.identityNumber, '临时编号-A01');
      const duplicateCreate = await request(
        'POST',
        '/resources/guide-people',
        root,
        personInput,
      );
      assert.equal(duplicateCreate.status, 201);
      const duplicate = (
        (await duplicateCreate.json()) as { data: { id: string } }
      ).data;
      assert.notEqual(duplicate.id, person.id);
      const blankCreate = await request(
        'POST',
        '/resources/guide-people',
        root,
        {
          library: 'shengxu',
          name: '测试导游',
          certificateNo: '',
          status: 'enabled',
        },
      );
      assert.equal(blankCreate.status, 201);
      const blank = (
        (await blankCreate.json()) as {
          data: {
            age: number | null;
            contact: string | null;
            employmentType: string | null;
            hasLaborContract: boolean | null;
            remark: string | null;
            certificateNo: string | null;
            identityNumber: string | null;
          };
        }
      ).data;
      assert.equal(blank.certificateNo, null);
      assert.equal(blank.identityNumber, null);
      assert.equal(blank.age, null);
      assert.equal(blank.contact, null);
      assert.equal(blank.employmentType, null);
      assert.equal(blank.hasLaborContract, null);
      assert.equal(blank.remark, null);
      assert.equal(
        (
          await httpData<{ total: number }>(
            await request(
              'GET',
              '/resources/guide-people?keyword=guide-01',
              root,
            ),
          )
        ).total,
        2,
      );
      assert.equal(
        (
          await httpData<{ total: number }>(
            await request(
              'GET',
              '/resources/guide-people?keyword=00123x',
              root,
            ),
          )
        ).total,
        2,
      );
      assert.equal(
        (
          await httpData<{ certificateNo: string; identityNumber: string }>(
            await request('GET', `/resources/guide-people/${person.id}`, root),
          )
        ).identityNumber,
        '临时编号-A01',
      );
      const updatedPerson = await httpData<{
        version: number;
        certificateNo: string;
        identityNumber: string;
        age: number | null;
        contact: string | null;
        employmentType: string | null;
        hasLaborContract: boolean | null;
        remark: string | null;
        status: string;
      }>(
        await request('PUT', `/resources/guide-people/${person.id}`, root, {
          ...personInput,
          version: person.version,
          certificateNo: ' 00123x ',
          identityNumber: '临时编号-A01',
          age: null,
          contact: '',
          employmentType: 'full_time',
          hasLaborContract: true,
          remark: '',
          status: 'disabled',
        }),
      );
      assert.equal(updatedPerson.certificateNo, ' 00123x ');
      assert.equal(updatedPerson.identityNumber, '临时编号-A01');
      assert.equal(updatedPerson.age, null);
      assert.equal(updatedPerson.contact, null);
      assert.equal(updatedPerson.employmentType, 'full_time');
      assert.equal(updatedPerson.hasLaborContract, true);
      assert.equal(updatedPerson.remark, null);
      assert.equal(updatedPerson.status, 'disabled');
      assert.ok(updatedPerson.version > person.version);
      assert.equal(
        (
          await request(
            'POST',
            '/resources/guide-people',
            executive,
            personInput,
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await request(
            'GET',
            `/resources/guide-people/${person.id}`,
            executive,
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await request(
            'GET',
            `/resources/guide-people/${person.id}`,
            websiteResources,
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await request(
            'GET',
            '/resources/guide-people?library=shengxu',
            websiteResources,
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await request(
            'POST',
            '/resources/guide-people',
            websiteResources,
            personInput,
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await request('POST', '/resources/guide-people', root, {
            ...personInput,
            certificateNo: 123,
          })
        ).status,
        400,
      );
      for (const invalidField of [
        { age: -1 },
        { employmentType: 'temporary' },
        { hasLaborContract: 'yes' },
      ]) {
        assert.equal(
          (
            await request('POST', '/resources/guide-people', root, {
              ...personInput,
              ...invalidField,
            })
          ).status,
          400,
        );
      }
      assert.equal(
        (
          await request(
            'DELETE',
            `/resources/guide-people?ids=${person.id}`,
            root,
          )
        ).status,
        204,
      );
      assert.equal(
        (await request('GET', `/resources/guide-people/${person.id}`, root))
          .status,
        404,
      );
      const sharedPriceInput = {
        secondLanguage: 'en',
        shopping: true,
        dailyPrice: '500',
        status: 'enabled',
      };
      const sharedPriceCreate = await request(
        'POST',
        '/resources/guides',
        websiteResources,
        sharedPriceInput,
      );
      assert.equal(
        sharedPriceCreate.status,
        201,
        await sharedPriceCreate.clone().text(),
      );
      const sharedPrice = (
        (await sharedPriceCreate.json()) as {
          data: { id: string; version: number; status: string };
        }
      ).data;
      assert.equal(sharedPrice.status, 'enabled');
      const disabledPrice = await httpData<{ status: string }>(
        await request(
          'PUT',
          `/resources/guides/${sharedPrice.id}`,
          websiteResources,
          {
            ...sharedPriceInput,
            version: sharedPrice.version,
            status: 'disabled',
          },
        ),
      );
      assert.equal(disabledPrice.status, 'disabled');
      assert.deepEqual(
        await httpData<{ id: string; dailyPrice: string }>(
          await request('GET', `/resources/guides/${ids.guide}`, root),
        ),
        guidePriceBefore,
      );
      assert.deepEqual(
        await db.query(
          'SELECT snapshot FROM itinerary_quotes WHERE itinerary_id=$1',
          [ids.quoted],
        ),
        frozenBefore,
      );
      assert.equal(
        (await request('GET', '/inquiries', websiteResources)).status,
        403,
      );
      assert.equal(
        (await request('GET', `/itineraries/${copy.id}`, websiteResources))
          .status,
        403,
      );
      for (const path of [
        `/resources/agencies/${ids.agency}`,
        `/resources/agencies/${ids.agency}/contacts`,
        `/resources/hotels/${ids.hotel}`,
        `/resources/transports/${ids.vehicle}`,
      ])
        assert.equal(
          (await request('GET', path, websiteResources)).status,
          403,
          path,
        );
      assert.equal(
        (
          await request(
            'GET',
            '/resources/selections/hotels?library=shengxu',
            websiteResources,
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await httpData<{ total: number }>(
            await request('GET', '/resources/hotels', websiteResources),
          )
        ).total,
        0,
      );
      const sameCities = await httpData<Array<{ id: string }>>(
        await request('GET', '/resources/cities/options', websiteResources),
      );
      assert.equal(sameCities[0].id, shared[0].id);
      const sharedAgencyResponse = await request(
        'POST',
        '/resources/agencies',
        websiteResources,
        {
          name: '共享旅行社',
          city: '昆明',
          countryOrRegion: '',
          email: '',
          status: 'enabled',
          remark: '',
        },
      );
      assert.equal(
        sharedAgencyResponse.status,
        201,
        await sharedAgencyResponse.clone().text(),
      );
      const sharedAgency = (
        (await sharedAgencyResponse.json()) as {
          data: { id: string; version: number; code: string };
        }
      ).data;
      assert.equal(
        (
          await request(
            'GET',
            `/resources/agencies/${sharedAgency.id}`,
            lxActor,
          )
        ).status,
        200,
      );
      const contactResponse = await request(
        'POST',
        `/inquiries/contacts/${sharedAgency.id}`,
        lxActor,
        { name: '共享联系人', phone: '123456' },
      );
      assert.equal(
        contactResponse.status,
        201,
        await contactResponse.clone().text(),
      );
      const sharedContact = (
        (await contactResponse.json()) as { data: { id: string } }
      ).data;
      const sharedInquiryResponse = await request(
        'POST',
        '/inquiries',
        lxActor,
        {
          agencyId: sharedAgency.id,
          contactId: sharedContact.id,
          sourceChannel: 'Email',
          originalMessage: '共享资源，询盘独立',
          plannedDays: 3,
          internalRemark: '',
          lostReason: '',
        },
      );
      assert.equal(
        sharedInquiryResponse.status,
        201,
        await sharedInquiryResponse.clone().text(),
      );
      const sharedInquiry = (
        (await sharedInquiryResponse.json()) as { data: { id: string } }
      ).data;
      const websiteUser = await createUser(
        'web-coordinator',
        'website',
        7,
        'COORDINATOR',
      );
      const webActor = await current(websiteUser.id, 'website');
      assert.equal(
        (
          await request(
            'GET',
            `/resources/agencies/${sharedAgency.id}`,
            webActor,
          )
        ).status,
        200,
      );
      assert.equal(
        (await request('GET', `/inquiries/${sharedInquiry.id}`, webActor))
          .status,
        404,
      );
      assert.equal(
        (await request('GET', `/inquiries/${sharedInquiry.id}`, other)).status,
        404,
      );
      assert.equal(
        (await request('GET', `/inquiries/${sharedInquiry.id}`, system)).status,
        200,
      );
      assert.equal(
        (
          await request(
            'GET',
            `/users/${exec.id}`,
            await current(manager.id, 'shengxu'),
          )
        ).status,
        404,
      );
      const profile = await httpData<{ scope: string; deptId: number }>(
        await request('GET', '/auth/me', lxActor),
      );
      assert.equal(profile.scope, 'linxi');
      assert.equal(profile.deptId, 5);
    } finally {
      await app.close();
    }

    console.log(
      `PASS: empty chain, rejected unmapped data rollback, legacy migration, repeat migration, guide-person text/duplicates/soft-delete/scope, guide-price status, HTTP permissions, shared resources, transaction rollback, consecutive-save versions, scoped identities, read-only access, resource isolation, price history, save/copy/freeze, transfer and disable. Isolated database: ${database}`,
    );
  } finally {
    await db.destroy();
  }
}
void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
