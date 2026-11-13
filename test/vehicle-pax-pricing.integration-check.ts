/** Real HTTP and SQL against the disposable localhost IsolationHarness only. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { IsolationHarness } from './business-isolation.harness';
import { priceDraft, priceResourceIds } from './fixtures/nullable-draft-prices';
import { ItineraryInput } from '../src/inquiries/inquiry.dto';
import { AddVehiclePaxPrices1795737600000 } from '../src/migrations/1795737600000-AddVehiclePaxPrices';
import { RequireVehicleQuotationMode1796256006000 } from '../src/migrations/1796256006000-RequireVehicleQuotationMode';

type Record = ItineraryInput & { id: string; version: number };
type Calculation = {
  options: {
    vehicleTotal: string | null;
    paxPrices: { pax: number; vehicleTotal: string; vehicleUnitCost: string }[];
  }[];
};
const h = new IsolationHarness();
async function run() {
  try {
    await h.start();
    assert.equal((await h.db.runMigrations()).length, 0);
    const actor = await h.actor('shengxu');
    const [{ id: countryId }] = await h.db.query<{ id: string }[]>(
      `INSERT INTO system_business_dictionary_items(type_id,code,name,english_name) SELECT id,'PAX','测试国家','Test' FROM system_business_dictionary_types WHERE code='country-region' RETURNING id`,
    );
    const agencyId = randomUUID(),
      contactId = randomUUID();
    await h.db.query(
      `INSERT INTO resource_agencies(id,code,name,business_unit,coordinator_id,country_item_id) VALUES($1,next_business_code('AGY'),'PAX test','shengxu',$2,$3)`,
      [agencyId, actor.id, countryId],
    );
    await h.db.query(
      `INSERT INTO resource_agency_contacts(id,agency_id,name,name_key) VALUES($1,$2,'PAX','pax')`,
      [contactId, agencyId],
    );
    await h.db.query(
      `INSERT INTO resource_cities(code,name,province) VALUES(next_business_code('CITY'),'杭州','浙江')`,
    );
    await h.db.query(
      `INSERT INTO resource_hotels(id,code,name,city,rating,individual_price,unit) VALUES($1,next_business_code('HTL'),'酒店','杭州',4,100,'roomNight')`,
      [priceResourceIds.hotel],
    );
    const inquiry = await h.call(
      actor,
      'POST',
      '/inquiries',
      {
        agencyId,
        contactId,
        countryItemId: countryId,
        sourceChannel: 'test',
        originalMessage: 'PAX test',
        plannedDays: 1,
      },
      201,
    );
    const initial = priceDraft();
    initial.paxTiers = [15, 20, 25];
    initial.vehiclePlans[0].paxPrices = initial.paxTiers.map((pax) => ({
      pax,
      totalPrice: 100,
      pricingMode: 'automatic',
    }));
    initial.vehiclePlans[0].arrangements[0].paxPrices = initial.paxTiers.map(
      (pax) => ({ pax, totalPrice: 100 }),
    );
    initial.quote.options[0].paxPrices = [];
    initial.guidePlans = [];
    initial.dailyPlans[0].items = [];
    initial.dailyPlans[0].meals.lunch = false;
    const legacy = await h.call<Record>(
      actor,
      'POST',
      `/inquiries/${inquiry.id}/itineraries`,
      initial,
      201,
    );
    await h.call(
      actor,
      'POST',
      `/itineraries/${legacy.id}/confirm-pdf`,
      {
        version: legacy.version,
        inquiryVersion: (await h.call(actor, 'GET', `/inquiries/${inquiry.id}`))
          .version,
      },
      201,
    );
    const before = await h.db.query<{ snapshot: unknown }[]>(
      'SELECT snapshot FROM itinerary_quotes WHERE itinerary_id=$1',
      [legacy.id],
    );
    // Reconstruct the pre-addition schema inside a rollback-only test transaction.
    const q = h.db.createQueryRunner();
    await q.connect();
    await q.startTransaction();
    try {
      await q.query(`DROP TABLE quote_vehicle_range_pax_prices,quote_vehicle_pax_prices,itinerary_vehicle_range_pax_prices,itinerary_vehicle_pax_prices;
        ALTER TABLE itinerary_vehicle_plans DROP COLUMN quotation_mode;
        ALTER TABLE quote_pax_prices DROP COLUMN vehicle_total;`);
      const totals: unknown = await q.query(
        'SELECT total_price FROM itinerary_vehicle_plans WHERE itinerary_id=$1',
        [legacy.id],
      );
      await new AddVehiclePaxPrices1795737600000().up(q);
      assert.deepEqual(
        await q.query(
          'SELECT total_price FROM itinerary_vehicle_plans WHERE itinerary_id=$1',
          [legacy.id],
        ),
        totals,
      );
      assert.deepEqual(
        await q.query(
          'SELECT snapshot FROM itinerary_quotes WHERE itinerary_id=$1',
          [legacy.id],
        ),
        before,
      );
      // Shared-price plans become PAX-tier plans with the same totals; frozen quotes stay untouched.
      await q.query(
        "UPDATE itinerary_vehicle_plans SET total_price=100,pricing_mode='automatic',segment_total=100 WHERE itinerary_id=$1",
        [legacy.id],
      );
      await q.query(
        'UPDATE itinerary_vehicle_ranges SET total_price=100 WHERE itinerary_id=$1',
        [legacy.id],
      );
      await new RequireVehicleQuotationMode1796256006000().up(q);
      assert.deepEqual(
        await q.query(
          'SELECT quotation_mode,total_price,pricing_mode FROM itinerary_vehicle_plans WHERE itinerary_id=$1',
          [legacy.id],
        ),
        [{ quotation_mode: 'stage', total_price: null, pricing_mode: null }],
      );
      assert.deepEqual(
        await q.query(
          'SELECT pax,total_price::text,pricing_mode,segment_total::text FROM itinerary_vehicle_pax_prices WHERE itinerary_id=$1 ORDER BY pax',
          [legacy.id],
        ),
        [15, 20, 25].map((pax) => ({
          pax,
          total_price: '100',
          pricing_mode: 'automatic',
          segment_total: '100',
        })),
      );
      assert.deepEqual(
        await q.query(
          'SELECT pax,total_price::text FROM itinerary_vehicle_range_pax_prices WHERE itinerary_id=$1 ORDER BY pax',
          [legacy.id],
        ),
        [15, 20, 25].map((pax) => ({ pax, total_price: '100' })),
      );
      assert.deepEqual(
        await q.query(
          'SELECT snapshot FROM itinerary_quotes WHERE itinerary_id=$1',
          [legacy.id],
        ),
        before,
      );
    } finally {
      await q.rollbackTransaction();
      await q.release();
    }
    let record = await h.call<Record>(
      actor,
      'POST',
      `/itineraries/${legacy.id}/copy`,
      { version: legacy.version + 1, title: 'PAX new' },
      201,
    );
    const body = (r: Record): ItineraryInput =>
      structuredClone(
        Object.fromEntries(
          Object.keys(initial).map((key) => [
            key,
            (r as unknown as { [key: string]: unknown })[key],
          ]),
        ),
      ) as unknown as ItineraryInput;
    let next = body(record);
    const plan = next.vehiclePlans[0];
    plan.quotationMode = 'stage';
    plan.totalPrice = null;
    plan.paxPrices = [15, 20, 25].map((pax) => ({
      pax,
      totalPrice: null,
      pricingMode: 'automatic',
    }));
    plan.arrangements[0].totalPrice = null;
    plan.arrangements[0].paxPrices = [15, 20, 25].map((pax, i) => ({
      pax,
      totalPrice: [13200, 14000, 15500][i],
    }));
    record = await h.call<Record>(actor, 'PUT', `/itineraries/${record.id}`, {
      ...next,
      version: record.version,
    });
    const read = await h.call<Record>(
      actor,
      'GET',
      `/itineraries/${record.id}`,
    );
    assert.deepEqual(read.vehiclePlans, record.vehiclePlans);
    assert.equal(read.vehiclePlans[0].paxPrices!.length, 3);
    let calculation = await h.call<Calculation>(
      actor,
      'GET',
      `/itineraries/${record.id}/quote-calculation`,
    );
    assert.equal(calculation.options[0].vehicleTotal, null);
    assert.deepEqual(
      calculation.options[0].paxPrices.map((p) => p.vehicleUnitCost),
      ['880.00', '700.00', '620.00'],
    );
    const path = `/itineraries/${record.id}`;
    await h.call(
      actor,
      'PUT',
      path,
      {
        ...initial,
        vehiclePlans: initial.vehiclePlans.map((p) => ({
          ...p,
          quotationMode: undefined,
        })),
        version: record.version,
      },
      400,
      'VALIDATION_ERROR',
    );
    const baseline = await h.call<Record>(actor, 'GET', path);
    next = body(record);
    next.vehiclePlans[0].quotationMode = 'itinerary';
    await h.call(
      actor,
      'PUT',
      path,
      { ...next, version: record.version },
      400,
      'ITINERARY_INVALID',
    );
    assert.deepEqual(await h.call<Record>(actor, 'GET', path), baseline);
    // Confirmed switch creates fresh ranges. Empty Draft ranges are allowed until complete.
    next.confirmVehicleModeChange = true;
    next.vehiclePlans[0].arrangements = [];
    next.vehiclePlans[0].paxPrices!.forEach((p) => {
      p.totalPrice = null;
    });
    const preview = await h.call<Calculation>(
      actor,
      'POST',
      `${path}/quote-calculation`,
      next,
      201,
    );
    assert.equal(preview.options.length, 0);
    assert.deepEqual(await h.call<Record>(actor, 'GET', path), baseline);
    // Saving another edit with a stale parent version cannot overwrite the current prices.
    next = body(record);
    next.vehiclePlans[0].arrangements[0].paxPrices![1].totalPrice = 16000;
    await h.call(
      actor,
      'PUT',
      path,
      { ...next, version: record.version - 1 },
      409,
      'ITINERARY_VERSION_CONFLICT',
    );
    record = await h.call<Record>(actor, 'PUT', path, {
      ...next,
      version: record.version,
    });
    calculation = await h.call<Calculation>(
      actor,
      'GET',
      `${path}/quote-calculation`,
    );
    assert.deepEqual(
      calculation.options[0].paxPrices.map((p) => p.vehicleUnitCost),
      ['880.00', '800.00', '620.00'],
    );
    const history = await h.db.query<{ item_key: string }[]>(
      'SELECT item_key FROM itinerary_price_adjustments WHERE itinerary_id=$1',
      [record.id],
    );
    assert(history.some((p) => p.item_key === 'vehicle:standard:20'));
    await h.call(
      actor,
      'POST',
      `${path}/confirm-pdf`,
      {
        version: record.version,
        inquiryVersion: (await h.call(actor, 'GET', `/inquiries/${inquiry.id}`))
          .version,
      },
      201,
    );
    const frozen = await h.call(actor, 'GET', `${path}/pdf-data`);
    const rows = await h.db.query<{ pax: number; total_price: string }[]>(
      'SELECT pax,total_price FROM quote_vehicle_pax_prices WHERE quote_id=(SELECT id FROM itinerary_quotes WHERE itinerary_id=$1) ORDER BY pax',
      [record.id],
    );
    assert.deepEqual(
      rows.map((p) => Number(p.total_price)),
      [13200, 16000, 15500],
    );
    assert.equal(
      (
        await h.db.query<unknown[]>(
          'SELECT * FROM quote_vehicle_range_pax_prices WHERE quote_id=(SELECT id FROM itinerary_quotes WHERE itinerary_id=$1)',
          [record.id],
        )
      ).length,
      3,
    );
    const copied = await h.call<Record>(
      actor,
      'POST',
      `${path}/copy`,
      { version: record.version + 1, title: 'PAX copy' },
      201,
    );
    assert.deepEqual(
      copied.vehiclePlans[0].paxPrices,
      record.vehiclePlans[0].paxPrices,
    );
    assert.notEqual(
      copied.vehiclePlans[0].arrangements[0].id,
      record.vehiclePlans[0].arrangements[0].id,
    );
    await h.db.query(
      'UPDATE resource_hotels SET individual_price=999 WHERE id=$1',
      [priceResourceIds.hotel],
    );
    assert.deepEqual(await h.call(actor, 'GET', `${path}/pdf-data`), frozen);
    assert.deepEqual(
      await h.db.query(
        'SELECT snapshot FROM itinerary_quotes WHERE itinerary_id=$1',
        [legacy.id],
      ),
      before,
    );
    console.log(
      `PASS: ${h.requests} HTTP requests; full/duplicate migrations, populated-schema upgrade, PAX persistence/calculation/preview/version/history/copy/freeze, legacy snapshots unchanged.`,
    );
  } finally {
    await h.close();
  }
}
void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
