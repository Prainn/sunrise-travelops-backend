import { EntityManager, MigrationInterface, QueryRunner } from 'typeorm';
import type { ItineraryInput } from '../inquiries/inquiry.dto';
import type { PdfData } from '../inquiries/inquiry.entity';

export class StructureBusinessAndIdentity1789459200000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE resource_libraries(code text PRIMARY KEY,name text NOT NULL);
      INSERT INTO resource_libraries VALUES ('shengxu','盛旭资源库'),('shared','霖熹 / 独立站共享资源库');
      CREATE TABLE business_units(code text PRIMARY KEY,name text NOT NULL,resource_library text NOT NULL REFERENCES resource_libraries(code));
      INSERT INTO business_units VALUES ('shengxu','盛旭','shengxu'),('linxi','霖熹','shared'),('website','独立站','shared');
      CREATE TABLE departments(id integer PRIMARY KEY,name text NOT NULL,scope text NOT NULL CHECK(scope IN ('headquarters','shengxu','linxi','website')), UNIQUE(id,scope));`);
    for (const dept of DEPARTMENT_OPTIONS)
      await q.query('INSERT INTO departments VALUES ($1,$2,$3)', [
        dept.value,
        dept.label,
        dept.scope,
      ]);
    await q.query(`ALTER TABLE users DROP CONSTRAINT "UQ_users_username", ADD CONSTRAINT "UQ_users_id_username" UNIQUE(id,username), ADD COLUMN is_superuser boolean NOT NULL DEFAULT false;
      UPDATE users SET is_superuser=true WHERE username='sunrise';
      CREATE UNIQUE INDEX "UQ_users_superuser" ON users(is_superuser) WHERE is_superuser;
      CREATE TABLE user_identities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,username varchar(80) NOT NULL,scope text NOT NULL CHECK(scope IN ('headquarters','shengxu','linxi','website')),dept_id integer,refresh_token_hash text,
        CONSTRAINT "UQ_identity_login" UNIQUE(scope,username),CONSTRAINT "UQ_identity_user_scope" UNIQUE(user_id,scope),
        FOREIGN KEY(user_id,username) REFERENCES users(id,username),FOREIGN KEY(dept_id,scope) REFERENCES departments(id,scope));
      CREATE TABLE identity_roles(identity_id uuid NOT NULL REFERENCES user_identities(id) ON DELETE CASCADE,role_id uuid NOT NULL REFERENCES roles(id),PRIMARY KEY(identity_id,role_id));`);
    for (const [code, name] of Object.entries({
      ROOT: '超级管理员',
      ADMIN: '系统管理部',
      EXECUTIVE: '总经办',
      BUSINESS_MANAGER: '业务部门负责人',
      COORDINATOR: '计调',
      RESOURCE_MANAGER: '资源管理员',
    }))
      await q.query(
        'INSERT INTO roles(code,name) VALUES ($1,$2) ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name',
        [code, name],
      );
    const unknown = (await q.query(
      `SELECT u.id,u.username,r.code FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE r.code NOT IN ('ROOT','ADMIN','EXECUTIVE','BUSINESS_MANAGER','COORDINATOR','RESOURCE_MANAGER')`,
    )) as unknown[];
    if (unknown.length)
      throw new Error(`Unmapped legacy user roles: ${JSON.stringify(unknown)}`);
    await q.query(`INSERT INTO user_identities(user_id,username,scope,dept_id)
      SELECT u.id,u.username,'headquarters',CASE WHEN u.is_superuser THEN NULL WHEN EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.code='EXECUTIVE') THEN 4 ELSE 1 END FROM users u WHERE u.is_superuser OR EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.code IN ('ROOT','ADMIN','EXECUTIVE'));
      INSERT INTO user_identities(user_id,username,scope,dept_id)
      SELECT u.id,u.username,'shengxu',CASE WHEN u.dept_id IN (2,3) THEN u.dept_id WHEN EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.code='COORDINATOR') THEN 3 ELSE 2 END FROM users u WHERE NOT u.is_superuser AND EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.code IN ('BUSINESS_MANAGER','COORDINATOR','RESOURCE_MANAGER'));
      INSERT INTO identity_roles SELECT i.id,r.id FROM user_identities i JOIN users u ON u.id=i.user_id JOIN user_roles ur ON ur.user_id=u.id JOIN roles old ON old.id=ur.role_id JOIN roles r ON r.code=CASE WHEN i.scope='headquarters' AND u.is_superuser THEN 'ROOT' WHEN old.code='ROOT' THEN 'ADMIN' ELSE old.code END WHERE (i.scope='headquarters' AND old.code IN ('ROOT','ADMIN','EXECUTIVE')) OR (i.scope='shengxu' AND old.code IN ('BUSINESS_MANAGER','COORDINATOR','RESOURCE_MANAGER')) ON CONFLICT DO NOTHING;
      INSERT INTO identity_roles SELECT i.id,r.id FROM user_identities i JOIN users u ON u.id=i.user_id CROSS JOIN roles r WHERE u.is_superuser AND r.code='ROOT' ON CONFLICT DO NOTHING;`);
    const missing = (await q.query(
      `SELECT id,username FROM users WHERE deleted_at IS NULL AND status='enabled' AND NOT EXISTS(SELECT 1 FROM user_identities i WHERE i.user_id=users.id)`,
    )) as unknown[];
    if (missing.length)
      throw new Error(
        `Enabled users without an explicit legacy identity: ${JSON.stringify(missing)}`,
      );
    await q.query(
      "DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE code IN ('ROOT','ADMIN','EXECUTIVE','BUSINESS_MANAGER','COORDINATOR','RESOURCE_MANAGER'))",
    );
    for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS))
      for (const permission of permissions) {
        await q.query(
          'INSERT INTO permissions(code,name) VALUES($1,$1) ON CONFLICT DO NOTHING',
          [permission],
        );
        await q.query(
          'INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.code=$1 AND p.code=$2 ON CONFLICT DO NOTHING',
          [role, permission],
        );
      }
    await q.query(
      'DROP TABLE user_roles; ALTER TABLE users DROP COLUMN dept_id,DROP COLUMN refresh_token_hash',
    );
    for (const table of [
      'resource_cities',
      'resource_agencies',
      'resource_hotels',
      'resource_restaurants',
      'resource_attractions',
      'resource_transports',
      'resource_guides',
    ])
      await q.query(
        `ALTER TABLE ${table} ADD COLUMN library text NOT NULL DEFAULT 'shengxu' REFERENCES resource_libraries(code); ALTER TABLE ${table} ALTER COLUMN library DROP DEFAULT; CREATE INDEX ${table}_library_status ON ${table}(library,status) WHERE deleted_at IS NULL`,
      );
    await q.query(
      `DROP INDEX "UQ_resource_guides_service"; CREATE UNIQUE INDEX "UQ_resource_guides_service" ON resource_guides(library,second_language,shopping) WHERE deleted_at IS NULL`,
    );
    const cityIndexes = (await q.query(
      `SELECT indexname,indexdef FROM pg_indexes WHERE tablename='resource_cities'`,
    )) as Array<{ indexname: string; indexdef: string }>;
    for (const index of cityIndexes)
      if (
        index.indexdef.includes('UNIQUE') &&
        index.indexdef.includes('(name)')
      ) {
        await q.query(`DROP INDEX "${index.indexname.replace(/"/g, '""')}"`);
        await q.query(
          `CREATE UNIQUE INDEX "${index.indexname.replace(/"/g, '""')}" ON resource_cities(library,name) WHERE deleted_at IS NULL`,
        );
      }
    const inquiryFields: Record<string, string> = {
      agencyId: 'uuid',
      contactId: 'uuid',
      agencyCode: 'text',
      agencyName: 'text',
      contactName: 'text',
      email: 'text',
      phone: 'text',
      countryOrRegion: 'text',
      sourceChannel: 'text',
      originalMessage: 'text',
      internalRemark: 'text',
      plannedDays: 'integer',
      nextFollowUpAt: 'text',
      lostReason: 'text',
    };
    await q.query(
      `ALTER TABLE inquiries ADD COLUMN business_unit text NOT NULL DEFAULT 'shengxu' REFERENCES business_units(code); ALTER TABLE inquiries ALTER COLUMN business_unit DROP DEFAULT`,
    );
    const inquiries = (await q.query(
      'SELECT id,data FROM inquiries',
    )) as Array<{ id: string; data: Record<string, unknown> }>;
    for (const row of inquiries) {
      checkKeys(row.data, Object.keys(inquiryFields), `inquiry ${row.id}`);
      for (const [field, type] of Object.entries(inquiryFields))
        checkScalar(
          row.data[field],
          type + (field === 'nextFollowUpAt' ? '?' : ''),
          `inquiry ${row.id}.${field}`,
        );
    }
    for (const [field, type] of Object.entries(inquiryFields)) {
      const name = columnName(field);
      await q.query(
        `ALTER TABLE inquiries ADD COLUMN ${name} ${type}; UPDATE inquiries SET ${name}=(data->>'${field}')::${type}`,
      );
      if (field !== 'nextFollowUpAt')
        await q.query(
          `ALTER TABLE inquiries ALTER COLUMN ${name} SET NOT NULL`,
        );
    }
    await q.query(
      `CREATE INDEX inquiries_scope_owner_status ON inquiries(business_unit,owner_id,status); CREATE INDEX inquiries_scope_source ON inquiries(business_unit,source_channel); ALTER TABLE inquiries ADD CHECK(planned_days BETWEEN 1 AND 365)`,
    );
    const sourceItineraries = (await q.query(
      'SELECT id,data FROM itineraries',
    )) as Array<{ id: string; data: ItineraryInput }>;
    for (const row of sourceItineraries) checkItinerary(row.data, row.id);
    for (const [field, type] of Object.entries({
      title: 'text',
      startDate: 'text',
      adults: 'integer',
      childrenCount: 'integer',
      leaderCount: 'integer',
    }))
      await q.query(
        `ALTER TABLE itineraries ADD COLUMN ${columnName(field)} ${type}; UPDATE itineraries SET ${columnName(field)}=(data->>'${field}')::${type}; ALTER TABLE itineraries ALTER COLUMN ${columnName(field)} SET NOT NULL`,
      );
    for (const [table, fields] of Object.entries(ITINERARY_TABLES)) {
      await q.query(
        `CREATE TABLE ${table}(itinerary_id uuid NOT NULL REFERENCES itineraries(id), position integer NOT NULL CHECK(position>=0),${Object.entries(
          fields,
        )
          .map(
            ([field, type]) =>
              `${columnName(field)} ${type.replace('?', '')} ${type.endsWith('?') ? '' : 'NOT NULL'}`,
          )
          .join(',')}, PRIMARY KEY(itinerary_id,position))`,
      );
    }
    for (const [table, keys] of Object.entries({
      itinerary_days: 'id',
      itinerary_items: 'id',
      itinerary_hotel_plans: 'tier',
      itinerary_hotels: 'tier,destination',
      itinerary_vehicle_plans: 'tier',
      itinerary_vehicle_ranges: 'tier,id',
      itinerary_vehicles: 'tier,range_id,vehicle_id',
      itinerary_quote_options: 'id',
      itinerary_transport_fees: 'id',
    }))
      await q.query(`ALTER TABLE ${table} ADD UNIQUE(itinerary_id,${keys})`);
    await q.query(`ALTER TABLE itinerary_items ADD FOREIGN KEY(itinerary_id,day_id) REFERENCES itinerary_days(itinerary_id,id);
      ALTER TABLE itinerary_hotels ADD FOREIGN KEY(itinerary_id,tier) REFERENCES itinerary_hotel_plans(itinerary_id,tier);
      ALTER TABLE itinerary_vehicle_ranges ADD FOREIGN KEY(itinerary_id,tier) REFERENCES itinerary_vehicle_plans(itinerary_id,tier);
      ALTER TABLE itinerary_vehicles ADD FOREIGN KEY(itinerary_id,tier,range_id) REFERENCES itinerary_vehicle_ranges(itinerary_id,tier,id);
      ALTER TABLE itinerary_quote_settings ADD UNIQUE(itinerary_id);
      ALTER TABLE itinerary_quote_options ADD UNIQUE(itinerary_id,hotel_tier,vehicle_tier);`);
    const itineraries = (await q.query(
      'SELECT id,data FROM itineraries',
    )) as Array<{ id: string; data: ItineraryInput }>;
    for (const row of itineraries) {
      try {
        checkItinerary(row.data, row.id);
        const rows = itineraryRows(row.data);
        for (const [table, fields] of Object.entries(ITINERARY_TABLES))
          for (const [position, item] of rows[
            table as keyof typeof rows
          ].entries())
            for (const [field, type] of Object.entries(fields))
              checkScalar(
                item[field],
                type,
                `itinerary ${row.id}.${table}[${position}].${field}`,
              );
        for (const [table, fields] of Object.entries(ITINERARY_TABLES))
          for (const [position, item] of rows[
            table as keyof typeof rows
          ].entries()) {
            const names = Object.keys(fields);
            const values = names.map((name) => item[name] ?? null);
            await q.query(
              `INSERT INTO ${table}(itinerary_id,position,${names.map(columnName).join(',')}) VALUES($1,$2,${values.map((_, i) => `$${i + 3}`).join(',')})`,
              [row.id, position, ...values],
            );
          }
      } catch (error) {
        throw new Error(
          `Cannot migrate itinerary ${row.id}: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
    }
    await q.query(`ALTER TABLE itineraries ADD CHECK(adults>=1 AND children_count>=0 AND leader_count>=0);
      ALTER TABLE itinerary_destinations ADD UNIQUE(itinerary_id,destination);
      ALTER TABLE itinerary_days ADD UNIQUE(itinerary_id,day_number),ADD CHECK(day_number>=1);
      ALTER TABLE itinerary_guides ADD UNIQUE(itinerary_id),ADD CHECK(daily_price>=0 AND service_days>=1);
      ALTER TABLE itinerary_items ADD CHECK(quantity>=0 AND unit_cost>=0 AND total_cost>=0),ADD CHECK(type IN ('restaurant','attraction')),ADD CHECK((resource_id IS NULL AND resource_price_id IS NULL AND type='restaurant') OR (resource_id IS NOT NULL AND resource_price_id IS NOT NULL));
      ALTER TABLE itinerary_hotels ADD CHECK(unit_cost>=0);
      ALTER TABLE itinerary_vehicles ADD CHECK(seats>=1 AND quantity>=1);
      ALTER TABLE itinerary_vehicle_plans ADD CHECK(total_price>=0),ADD CHECK(pricing_mode IN ('automatic','manual','unknown'));
      ALTER TABLE itinerary_vehicle_ranges ADD CHECK(total_price>=0);
      ALTER TABLE itinerary_quote_options ADD CHECK(adult_unit_price>=0);
      ALTER TABLE itinerary_transport_fees ADD CHECK(unit_price>=0);`);
    await q.query(`CREATE TABLE inquiry_transfers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),inquiry_id uuid NOT NULL REFERENCES inquiries(id),previous_owner_id uuid NOT NULL REFERENCES users(id),new_owner_id uuid NOT NULL REFERENCES users(id),previous_owner_name text NOT NULL,new_owner_name text NOT NULL,reason text NOT NULL CHECK(length(trim(reason))>0),operator_id uuid NOT NULL REFERENCES users(id),operator_name text NOT NULL,occurred_at timestamptz NOT NULL DEFAULT now());
      CREATE INDEX inquiry_transfers_time ON inquiry_transfers(inquiry_id,occurred_at);
      CREATE TABLE itinerary_price_adjustments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),itinerary_id uuid NOT NULL REFERENCES itineraries(id),item_key text NOT NULL,item_type text NOT NULL,item_name text NOT NULL,reference_basis text NOT NULL,reference_price numeric,before_price numeric,after_price numeric NOT NULL,reason text NOT NULL,action text NOT NULL CHECK(action IN ('initial','adjusted','restored')),operator_id uuid NOT NULL REFERENCES users(id),operator_name text NOT NULL,occurred_at timestamptz NOT NULL DEFAULT now());
      CREATE INDEX itinerary_adjustments_item_time ON itinerary_price_adjustments(itinerary_id,item_key,occurred_at);
      ALTER TABLE itinerary_quotes ADD COLUMN quote_code text,ADD COLUMN quote_version integer,ADD COLUMN inquiry_id uuid REFERENCES inquiries(id),ADD COLUMN inquiry_version integer,ADD COLUMN hotel_guest_count integer,ADD COLUMN hotel_room_count integer,ADD COLUMN daily_resource_cost numeric,ADD COLUMN guide_cost numeric;
      CREATE TABLE quote_options(quote_id uuid NOT NULL REFERENCES itinerary_quotes(id),option_id text NOT NULL,position integer NOT NULL,hotel_tier text NOT NULL,vehicle_tier text NOT NULL,hotel_cost numeric NOT NULL,vehicle_cost numeric NOT NULL,common_group_cost numeric NOT NULL,base_group_cost numeric NOT NULL,base_cost_per_person numeric NOT NULL,single_supplement_unit_cost numeric NOT NULL,adult_unit_price numeric NOT NULL,child_unit_price numeric NOT NULL,total_price numeric NOT NULL,expected_profit numeric NOT NULL,margin_rate numeric NOT NULL,leader_foc_enabled boolean NOT NULL,PRIMARY KEY(quote_id,option_id));
      CREATE TABLE quote_lines(quote_id uuid NOT NULL,option_id text NOT NULL,position integer NOT NULL,type text NOT NULL,quantity integer NOT NULL,unit_price numeric NOT NULL,total_price numeric NOT NULL,PRIMARY KEY(quote_id,option_id,position),FOREIGN KEY(quote_id,option_id) REFERENCES quote_options(quote_id,option_id));
      CREATE TABLE quote_resource_lines(quote_id uuid NOT NULL REFERENCES itinerary_quotes(id),position integer NOT NULL,item_key text NOT NULL,type text NOT NULL,name text NOT NULL,resource_id uuid,price_id uuid,unit text NOT NULL,quantity numeric,unit_price numeric,total_price numeric,day_number integer,tier text,destination text,reference_price numeric,reference_basis text,adjustment_reason text,PRIMARY KEY(quote_id,position));
      CREATE TABLE quote_vehicle_ranges(quote_id uuid NOT NULL REFERENCES itinerary_quotes(id),tier text NOT NULL,range_id text NOT NULL,position integer NOT NULL,start_date text NOT NULL,end_date text NOT NULL,total_price numeric,PRIMARY KEY(quote_id,tier,range_id),UNIQUE(quote_id,tier,position));
      CREATE TABLE quote_vehicles(quote_id uuid NOT NULL,tier text NOT NULL,range_id text NOT NULL,position integer NOT NULL,vehicle_id uuid NOT NULL,vehicle_name text NOT NULL,seats integer NOT NULL,quantity integer NOT NULL,PRIMARY KEY(quote_id,tier,range_id,position),FOREIGN KEY(quote_id,tier,range_id) REFERENCES quote_vehicle_ranges(quote_id,tier,range_id));
      CREATE TABLE quote_extra_fees(quote_id uuid NOT NULL REFERENCES itinerary_quotes(id),position integer NOT NULL,item_key text NOT NULL,type text NOT NULL,amount numeric,departure_city text,arrival_city text,cabin text,PRIMARY KEY(quote_id,position));`);
    const quotes = (await q.query(
      'SELECT id,snapshot FROM itinerary_quotes',
    )) as Array<{ id: string; snapshot: PdfData }>;
    for (const row of quotes) {
      try {
        await saveFrozenDetails(q.manager, row.id, row.snapshot);
      } catch (error) {
        throw new Error(
          `Cannot migrate frozen quote ${row.id}: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
    }
    for (const column of [
      'quote_code',
      'quote_version',
      'inquiry_id',
      'inquiry_version',
      'hotel_guest_count',
      'hotel_room_count',
      'daily_resource_cost',
      'guide_cost',
    ])
      await q.query(
        `ALTER TABLE itinerary_quotes ALTER COLUMN ${column} SET NOT NULL`,
      );
    await q.query(
      'ALTER TABLE inquiries DROP COLUMN data; ALTER TABLE itineraries DROP COLUMN data',
    );
  }
  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Restore the complete pre-migration backup with its matching application; application rollback cannot restore this schema.',
      ),
    );
  }
}

// Immutable extraction definitions for this migration; do not import live runtime mappings.
const ITINERARY_TABLES = {
  itinerary_destinations: { destination: 'text' },
  itinerary_days: {
    id: 'text',
    dayNumber: 'integer',
    date: 'text',
    departure: 'text',
    destination: 'text',
    overnightDestination: 'text?',
    breakfast: 'boolean',
    lunch: 'boolean',
    dinner: 'boolean',
    transport: 'text',
    description: 'text?',
  },
  itinerary_items: {
    dayId: 'text',
    id: 'text',
    type: 'text',
    resourceId: 'uuid?',
    resourcePriceId: 'uuid?',
    resourceName: 'text',
    priceName: 'text',
    quantity: 'numeric',
    unit: 'text',
    unitCost: 'numeric',
    totalCost: 'numeric',
    remark: 'text',
    mealSlot: 'text?',
    referencePrice: 'numeric?',
    referenceBasis: 'text?',
    adjustmentReason: 'text?',
  },
  itinerary_hotel_plans: { tier: 'text' },
  itinerary_hotels: {
    tier: 'text',
    destination: 'text',
    hotelId: 'uuid',
    hotelName: 'text',
    rating: 'text',
    breakfast: 'text',
    unit: 'text',
    unitCost: 'numeric',
    referencePrice: 'numeric?',
    referenceBasis: 'text?',
    adjustmentReason: 'text?',
  },
  itinerary_vehicle_plans: {
    tier: 'text',
    totalPrice: 'numeric?',
    pricingMode: 'text?',
    segmentTotal: 'numeric?',
    adjustmentReason: 'text?',
  },
  itinerary_vehicle_ranges: {
    tier: 'text',
    id: 'text',
    startDate: 'text',
    endDate: 'text',
    totalPrice: 'numeric?',
  },
  itinerary_vehicles: {
    tier: 'text',
    rangeId: 'text',
    vehicleId: 'uuid',
    vehicleName: 'text',
    seats: 'integer',
    quantity: 'integer',
  },
  itinerary_guides: {
    destination: 'text',
    guideId: 'uuid',
    guideName: 'text',
    secondLanguage: 'text',
    shopping: 'boolean',
    dailyPrice: 'numeric',
    serviceDays: 'integer',
    referencePrice: 'numeric?',
    referenceBasis: 'text?',
    adjustmentReason: 'text?',
  },
  itinerary_quote_settings: {
    chineseTip: 'numeric?',
    englishTip: 'numeric?',
    otherExpenses: 'numeric?',
    customerNotes: 'text',
    holidayRestrictions: 'text',
    hotelReplacementTerms: 'text',
  },
  itinerary_quote_options: {
    id: 'text',
    hotelTier: 'text',
    vehicleTier: 'text',
    adultUnitPrice: 'numeric?',
    leaderFocEnabled: 'boolean',
  },
  itinerary_transport_fees: {
    id: 'text',
    type: 'text',
    departureCity: 'text',
    arrivalCity: 'text',
    cabin: 'text',
    unitPrice: 'numeric?',
  },
} as const;
const columnName = (name: string) =>
  name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
type Table = keyof typeof ITINERARY_TABLES;
type Row = Record<string, unknown>;
function itineraryRows(data: ItineraryInput): Record<Table, Row[]> {
  return {
    itinerary_destinations: data.destinations.map((destination) => ({
      destination,
    })),
    itinerary_days: data.dailyPlans.map(({ meals, ...day }) => ({
      ...day,
      ...meals,
    })),
    itinerary_items: data.dailyPlans.flatMap((d) =>
      d.items.map((i) => ({ ...i, dayId: d.id })),
    ),
    itinerary_hotel_plans: data.hotelPlans.map(({ tier }) => ({ tier })),
    itinerary_hotels: data.hotelPlans.flatMap((p) =>
      p.hotels.map((h) => ({ ...h, tier: p.tier })),
    ),
    itinerary_vehicle_plans: data.vehiclePlans.map((row) => ({ ...row })),
    itinerary_vehicle_ranges: data.vehiclePlans.flatMap((p) =>
      p.arrangements.map((a) => ({ ...a, tier: p.tier })),
    ),
    itinerary_vehicles: data.vehiclePlans.flatMap((p) =>
      p.arrangements.flatMap((a) =>
        a.vehicles.map((v) => ({ ...v, tier: p.tier, rangeId: a.id })),
      ),
    ),
    itinerary_guides: data.guidePlans.map((row) => ({ ...row })),
    itinerary_quote_settings: [{ ...data.quote }],
    itinerary_quote_options: data.quote.options.map((row) => ({ ...row })),
    itinerary_transport_fees: data.quote.transportFees.map((row) => ({
      ...row,
    })),
  };
}

async function saveFrozenDetails(
  manager: EntityManager,
  id: string,
  snapshot: PdfData,
) {
  const calculation = snapshot.calculation;
  await manager.query(
    'UPDATE itinerary_quotes SET quote_code=$2,quote_version=$3,inquiry_id=$4,inquiry_version=$5,hotel_guest_count=$6,hotel_room_count=$7,daily_resource_cost=$8,guide_cost=$9 WHERE id=$1',
    [
      id,
      snapshot.quoteCode,
      snapshot.quoteVersion,
      snapshot.inquiry.id,
      snapshot.inquiryVersion,
      calculation.hotelGuestCount,
      calculation.hotelRoomCount,
      calculation.dailyResourceCost,
      calculation.guideCost,
    ],
  );
  for (const [position, option] of calculation.options.entries()) {
    await manager.query(
      `INSERT INTO quote_options(quote_id,option_id,position,hotel_tier,vehicle_tier,hotel_cost,vehicle_cost,common_group_cost,base_group_cost,base_cost_per_person,single_supplement_unit_cost,adult_unit_price,child_unit_price,total_price,expected_profit,margin_rate,leader_foc_enabled) VALUES (${Array.from({ length: 17 }, (_, i) => `$${i + 1}`).join(',')})`,
      [
        id,
        option.optionId,
        position,
        option.hotelTier,
        option.vehicleTier,
        option.hotelCost,
        option.vehicleCost,
        option.commonGroupCost,
        option.baseGroupCost,
        option.baseCostPerPerson,
        option.singleSupplementUnitCost,
        option.adultUnitPrice,
        option.childUnitPrice,
        option.totalPrice,
        option.profit,
        option.actualMarginRate,
        snapshot.itinerary.quote.options.find((o) => o.id === option.optionId)!
          .leaderFocEnabled,
      ],
    );
    for (const [order, line] of option.lines.entries())
      await manager.query(
        'INSERT INTO quote_lines(quote_id,option_id,position,type,quantity,unit_price,total_price) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [
          id,
          option.optionId,
          order,
          line.type,
          line.quantity,
          line.unitPrice,
          line.totalPrice,
        ],
      );
  }
  const plan = snapshot.itinerary;
  const items = [
    ...plan.dailyPlans.flatMap((d) =>
      d.items.map((i) => ({
        key: i.id,
        destination: d.destination,
        referencePrice: i.referencePrice,
        referenceBasis: i.referenceBasis,
        adjustmentReason: i.adjustmentReason,
        type: i.type,
        name: i.resourceName,
        resourceId: i.resourceId,
        priceId: i.resourcePriceId,
        unit: i.unit,
        quantity: i.quantity,
        price: i.unitCost,
        total: i.totalCost,
        day: d.dayNumber,
        tier: null,
      })),
    ),
    ...plan.hotelPlans.flatMap((p) =>
      p.hotels.map((h) => ({
        key: `${p.tier}:${h.destination}`,
        destination: h.destination,
        referencePrice: h.referencePrice,
        referenceBasis: h.referenceBasis,
        adjustmentReason: h.adjustmentReason,
        type: 'hotel',
        name: h.hotelName,
        resourceId: h.hotelId,
        priceId: null,
        unit: h.unit,
        quantity: null,
        price: h.unitCost,
        total: null,
        day: null,
        tier: p.tier,
      })),
    ),
    ...plan.guidePlans.map((g) => ({
      key: g.guideId,
      destination: g.destination,
      referencePrice: g.referencePrice,
      referenceBasis: g.referenceBasis,
      adjustmentReason: g.adjustmentReason,
      type: 'guide',
      name: g.guideName,
      resourceId: g.guideId,
      priceId: null,
      unit: 'day',
      quantity: g.serviceDays,
      price: g.dailyPrice,
      total: null,
      day: null,
      tier: null,
    })),
    ...plan.vehiclePlans.map((v) => ({
      key: v.tier,
      destination: null,
      referencePrice: v.segmentTotal,
      referenceBasis: v.segmentTotal == null ? null : 'segment_total',
      adjustmentReason: v.adjustmentReason,
      type: 'vehicle',
      name: v.tier,
      resourceId: null,
      priceId: null,
      unit: 'trip',
      quantity: 1,
      price: v.totalPrice,
      total: v.totalPrice,
      day: null,
      tier: v.tier,
    })),
  ];
  for (const [position, item] of items.entries())
    await manager.query(
      'INSERT INTO quote_resource_lines(quote_id,position,item_key,type,name,resource_id,price_id,unit,quantity,unit_price,total_price,day_number,tier,destination,reference_price,reference_basis,adjustment_reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)',
      [
        id,
        position,
        item.key,
        item.type,
        item.name,
        item.resourceId,
        item.priceId,
        item.unit,
        item.quantity,
        item.price,
        item.total,
        item.day,
        item.tier,
        item.destination,
        item.referencePrice ?? null,
        item.referenceBasis ?? null,
        item.adjustmentReason ?? null,
      ],
    );
  for (const vehicle of plan.vehiclePlans)
    for (const [position, range] of vehicle.arrangements.entries()) {
      await manager.query(
        'INSERT INTO quote_vehicle_ranges(quote_id,tier,range_id,position,start_date,end_date,total_price) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [
          id,
          vehicle.tier,
          range.id,
          position,
          range.startDate,
          range.endDate,
          range.totalPrice ?? null,
        ],
      );
      for (const [order, selection] of range.vehicles.entries())
        await manager.query(
          'INSERT INTO quote_vehicles(quote_id,tier,range_id,position,vehicle_id,vehicle_name,seats,quantity) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
          [
            id,
            vehicle.tier,
            range.id,
            order,
            selection.vehicleId,
            selection.vehicleName,
            selection.seats,
            selection.quantity,
          ],
        );
    }
  const extras = [
    ...plan.quote.transportFees.map((f) => ({
      id: f.id,
      type: f.type,
      price: f.unitPrice,
      departure: f.departureCity,
      arrival: f.arrivalCity,
      cabin: f.cabin,
    })),
    ...(['chineseTip', 'englishTip', 'otherExpenses'] as const).map((key) => ({
      id: key,
      type: key,
      price: plan.quote[key],
      departure: null,
      arrival: null,
      cabin: null,
    })),
  ];
  for (const [position, extra] of extras.entries())
    await manager.query(
      'INSERT INTO quote_extra_fees(quote_id,position,item_key,type,amount,departure_city,arrival_city,cabin) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [
        id,
        position,
        extra.id,
        extra.type,
        extra.price,
        extra.departure,
        extra.arrival,
        extra.cabin,
      ],
    );
}

const ROLE_PERMISSIONS: Record<string, string[]> = {
  ROOT: [
    'sys:user:list',
    'sys:user:create',
    'sys:user:update',
    'sys:user:delete',
    'sys:user:import',
    'sys:user:export',
    'sys:user:reset-password',
    'sys:role:list',
    'sys:role:create',
    'sys:role:update',
    'sys:role:delete',
    'sys:dict:list',
    'sys:dict:create',
    'sys:dict:update',
    'sys:dict:delete',
    'sys:dict-item:list',
    'sys:dict-item:create',
    'sys:dict-item:update',
    'sys:dict-item:delete',
    'sys:business-dictionary:list',
    'sys:business-dictionary:create',
    'sys:business-dictionary:update',
    'sys:business-dictionary:delete',
    'resource:city:list',
    'resource:city:create',
    'resource:city:update',
    'resource:city:delete',
    'resource:agency:list',
    'resource:agency:create',
    'resource:agency:update',
    'resource:agency:delete',
    'resource:hotel:list',
    'resource:hotel:create',
    'resource:hotel:update',
    'resource:hotel:delete',
    'resource:restaurant:list',
    'resource:restaurant:create',
    'resource:restaurant:update',
    'resource:restaurant:delete',
    'resource:attraction:list',
    'resource:attraction:create',
    'resource:attraction:update',
    'resource:attraction:delete',
    'resource:transport:list',
    'resource:transport:create',
    'resource:transport:update',
    'resource:transport:delete',
    'resource:guide:list',
    'resource:guide:create',
    'resource:guide:update',
    'resource:guide:delete',
    'inquiry:list',
    'inquiry:create',
    'inquiry:update',
    'inquiry:archive',
    'itinerary:list',
    'itinerary:create',
    'itinerary:update',
    'itinerary:price',
    'itinerary:pdf',
    'inquiry:transfer',
    'itinerary:download',
  ],
  EXECUTIVE: [
    'sys:user:list',
    'sys:role:list',
    'sys:dict:list',
    'sys:dict-item:list',
    'sys:business-dictionary:list',
    'resource:city:list',
    'resource:agency:list',
    'resource:hotel:list',
    'resource:restaurant:list',
    'resource:attraction:list',
    'resource:transport:list',
    'resource:guide:list',
    'inquiry:list',
    'itinerary:list',
    'itinerary:download',
  ],
  ADMIN: [
    'sys:user:list',
    'sys:user:create',
    'sys:user:update',
    'sys:user:delete',
    'sys:user:import',
    'sys:user:export',
    'sys:user:reset-password',
    'sys:role:list',
    'sys:role:create',
    'sys:role:update',
    'sys:role:delete',
    'sys:dict:list',
    'sys:dict:create',
    'sys:dict:update',
    'sys:dict:delete',
    'sys:dict-item:list',
    'sys:dict-item:create',
    'sys:dict-item:update',
    'sys:dict-item:delete',
    'sys:business-dictionary:list',
    'sys:business-dictionary:create',
    'sys:business-dictionary:update',
    'sys:business-dictionary:delete',
    'resource:city:list',
    'resource:city:create',
    'resource:city:update',
    'resource:city:delete',
    'resource:agency:list',
    'resource:agency:create',
    'resource:agency:update',
    'resource:agency:delete',
    'resource:hotel:list',
    'resource:hotel:create',
    'resource:hotel:update',
    'resource:hotel:delete',
    'resource:restaurant:list',
    'resource:restaurant:create',
    'resource:restaurant:update',
    'resource:restaurant:delete',
    'resource:attraction:list',
    'resource:attraction:create',
    'resource:attraction:update',
    'resource:attraction:delete',
    'resource:transport:list',
    'resource:transport:create',
    'resource:transport:update',
    'resource:transport:delete',
    'resource:guide:list',
    'resource:guide:create',
    'resource:guide:update',
    'resource:guide:delete',
    'inquiry:list',
    'itinerary:list',
    'itinerary:download',
  ],
  BUSINESS_MANAGER: [
    'sys:business-dictionary:list',
    'inquiry:list',
    'inquiry:create',
    'inquiry:update',
    'itinerary:list',
    'itinerary:create',
    'itinerary:update',
    'itinerary:price',
    'itinerary:pdf',
    'resource:city:list',
    'resource:agency:list',
    'resource:hotel:list',
    'resource:restaurant:list',
    'resource:attraction:list',
    'resource:transport:list',
    'resource:guide:list',
    'resource:city:list',
    'resource:city:create',
    'resource:city:update',
    'resource:city:delete',
    'resource:agency:list',
    'resource:agency:create',
    'resource:agency:update',
    'resource:agency:delete',
    'resource:hotel:list',
    'resource:hotel:create',
    'resource:hotel:update',
    'resource:hotel:delete',
    'resource:restaurant:list',
    'resource:restaurant:create',
    'resource:restaurant:update',
    'resource:restaurant:delete',
    'resource:attraction:list',
    'resource:attraction:create',
    'resource:attraction:update',
    'resource:attraction:delete',
    'resource:transport:list',
    'resource:transport:create',
    'resource:transport:update',
    'resource:transport:delete',
    'resource:guide:list',
    'resource:guide:create',
    'resource:guide:update',
    'resource:guide:delete',
    'sys:user:list',
    'sys:user:create',
    'sys:user:update',
    'sys:user:delete',
    'sys:user:import',
    'sys:user:export',
    'sys:user:reset-password',
    'inquiry:archive',
    'inquiry:transfer',
    'itinerary:download',
  ],
  COORDINATOR: [
    'sys:business-dictionary:list',
    'inquiry:list',
    'inquiry:create',
    'inquiry:update',
    'itinerary:list',
    'itinerary:create',
    'itinerary:update',
    'itinerary:price',
    'itinerary:pdf',
    'resource:city:list',
    'resource:agency:list',
    'resource:hotel:list',
    'resource:restaurant:list',
    'resource:attraction:list',
    'resource:transport:list',
    'resource:guide:list',
    'itinerary:download',
  ],
  RESOURCE_MANAGER: [
    'sys:business-dictionary:list',
    'resource:city:list',
    'resource:city:create',
    'resource:city:update',
    'resource:city:delete',
    'resource:agency:list',
    'resource:agency:create',
    'resource:agency:update',
    'resource:agency:delete',
    'resource:hotel:list',
    'resource:hotel:create',
    'resource:hotel:update',
    'resource:hotel:delete',
    'resource:restaurant:list',
    'resource:restaurant:create',
    'resource:restaurant:update',
    'resource:restaurant:delete',
    'resource:attraction:list',
    'resource:attraction:create',
    'resource:attraction:update',
    'resource:attraction:delete',
    'resource:transport:list',
    'resource:transport:create',
    'resource:transport:update',
    'resource:transport:delete',
    'resource:guide:list',
    'resource:guide:create',
    'resource:guide:update',
    'resource:guide:delete',
  ],
};
const DEPARTMENT_OPTIONS = [
  { value: 1, label: '系统管理部', scope: 'headquarters' },
  { value: 2, label: '盛旭 · 资源管理部', scope: 'shengxu' },
  { value: 3, label: '盛旭 · 计调部', scope: 'shengxu' },
  { value: 4, label: '总经办', scope: 'headquarters' },
  { value: 5, label: '霖熹 · 计调部', scope: 'linxi' },
  { value: 6, label: '霖熹 · 资源管理部', scope: 'linxi' },
  { value: 7, label: '独立站 · 计调部', scope: 'website' },
  { value: 8, label: '独立站 · 资源管理部', scope: 'website' },
];

function checkKeys(value: object, allowed: readonly string[], path: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`Invalid object at ${path}`);
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extra.length)
    throw new Error(`Unmapped fields at ${path}: ${extra.join(', ')}`);
}
function checkScalar(value: unknown, type: string, path: string) {
  if (value == null) {
    if (type.endsWith('?')) return;
    throw new Error(`Missing field at ${path}`);
  }
  const invalid = type.startsWith('numeric')
    ? typeof value !== 'number' || !Number.isFinite(value) || value < 0
    : type.startsWith('integer')
      ? typeof value !== 'number' || !Number.isInteger(value) || value < 0
      : type.startsWith('boolean')
        ? typeof value !== 'boolean'
        : type.startsWith('uuid')
          ? typeof value !== 'string' ||
            !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
          : typeof value !== 'string';
  if (invalid) throw new Error(`Invalid ${type} at ${path}`);
}

function checkItinerary(data: ItineraryInput, id: string) {
  const at = `itinerary ${id}`;
  for (const [field, type] of Object.entries({
    title: 'text',
    startDate: 'text',
    adults: 'integer',
    childrenCount: 'integer',
    leaderCount: 'integer',
  }))
    checkScalar(data[field as keyof ItineraryInput], type, `${at}.${field}`);
  checkKeys(
    data,
    [
      'title',
      'startDate',
      'adults',
      'childrenCount',
      'leaderCount',
      'destinations',
      'dailyPlans',
      'hotelPlans',
      'vehiclePlans',
      'guidePlans',
      'quote',
    ],
    at,
  );
  data.dailyPlans.forEach((day, index) => {
    checkKeys(
      day,
      [
        ...Object.keys(ITINERARY_TABLES.itinerary_days).filter(
          (k) => !['breakfast', 'lunch', 'dinner'].includes(k),
        ),
        'meals',
        'items',
      ],
      `${at}.dailyPlans[${index}]`,
    );
    checkKeys(
      day.meals,
      ['breakfast', 'lunch', 'dinner'],
      `${at}.dailyPlans[${index}].meals`,
    );
    day.items.forEach((item, i) =>
      checkKeys(
        item,
        Object.keys(ITINERARY_TABLES.itinerary_items).filter(
          (k) => k !== 'dayId',
        ),
        `${at}.dailyPlans[${index}].items[${i}]`,
      ),
    );
  });
  data.hotelPlans.forEach((plan, index) => {
    checkKeys(plan, ['tier', 'hotels'], `${at}.hotelPlans[${index}]`);
    plan.hotels.forEach((item, i) =>
      checkKeys(
        item,
        Object.keys(ITINERARY_TABLES.itinerary_hotels).filter(
          (k) => k !== 'tier',
        ),
        `${at}.hotelPlans[${index}].hotels[${i}]`,
      ),
    );
  });
  data.vehiclePlans.forEach((plan, index) => {
    checkKeys(
      plan,
      [
        ...Object.keys(ITINERARY_TABLES.itinerary_vehicle_plans),
        'arrangements',
      ],
      `${at}.vehiclePlans[${index}]`,
    );
    plan.arrangements.forEach((range, i) => {
      checkKeys(
        range,
        [
          ...Object.keys(ITINERARY_TABLES.itinerary_vehicle_ranges).filter(
            (k) => k !== 'tier',
          ),
          'vehicles',
        ],
        `${at}.vehiclePlans[${index}].arrangements[${i}]`,
      );
      range.vehicles.forEach((vehicle, j) =>
        checkKeys(
          vehicle,
          Object.keys(ITINERARY_TABLES.itinerary_vehicles).filter(
            (k) => !['tier', 'rangeId'].includes(k),
          ),
          `${at}.vehiclePlans[${index}].arrangements[${i}].vehicles[${j}]`,
        ),
      );
    });
  });
  data.guidePlans.forEach((guide, i) =>
    checkKeys(
      guide,
      Object.keys(ITINERARY_TABLES.itinerary_guides),
      `${at}.guidePlans[${i}]`,
    ),
  );
  checkKeys(
    data.quote,
    [
      ...Object.keys(ITINERARY_TABLES.itinerary_quote_settings),
      'options',
      'transportFees',
    ],
    `${at}.quote`,
  );
  data.quote.options.forEach((item, i) =>
    checkKeys(
      item,
      Object.keys(ITINERARY_TABLES.itinerary_quote_options),
      `${at}.quote.options[${i}]`,
    ),
  );
  data.quote.transportFees.forEach((item, i) =>
    checkKeys(
      item,
      Object.keys(ITINERARY_TABLES.itinerary_transport_fees),
      `${at}.quote.transportFees[${i}]`,
    ),
  );
}
