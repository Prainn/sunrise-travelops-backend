import { CitiesService } from '../src/resources/cities/cities.service';
import { CityEntity } from '../src/resources/cities/city.entity';
/** Run explicitly against the local migrated database. All business fixtures are rolled back. */
import assert from 'node:assert/strict';
import type { Request } from 'express';
import { DataSource } from 'typeorm';
import db from '../src/database/data-source';
import { InquiriesService } from '../src/inquiries/inquiries.service';
import { ItineraryValidation } from '../src/inquiries/itinerary-validation';
import {
  InquiryInput,
  InquiryQuery,
  ItineraryInput,
  LogQuery,
} from '../src/inquiries/inquiry.dto';
import { UserEntity, UserStatus } from '../src/users/user.entity';
import { AgencyEntity } from '../src/resources/agencies/agency.entity';
import { ResourceStatus } from '../src/resources/common/resource.constants';
import { AgenciesService } from '../src/resources/agencies/agencies.service';
import { HotelEntity } from '../src/resources/hotels/hotel.entity';
import { TransportEntity } from '../src/resources/transports/transport.entity';
import { RestaurantPriceEntity } from '../src/resources/restaurants/restaurant.entity';
async function main() {
  await db.initialize();
  const runner = db.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const scoped = {
      manager: runner.manager,
      transaction: <T>(work: (manager: typeof runner.manager) => Promise<T>) =>
        work(runner.manager),
    } as DataSource;
    const service = new InquiriesService(
      scoped,
      new ItineraryValidation(),
      {} as AgenciesService,
    );
    const users = await runner.manager.find(UserEntity, {
      relations: { roles: true },
    });
    const coordinators = users.filter(
      (u) =>
        u.status === UserStatus.Enabled &&
        u.roles.some((r) => r.code === 'INQUIRY_COORDINATOR' && r.isEnabled) &&
        !u.roles.some((r) => ['ROOT', 'ADMIN'].includes(r.code)),
    );
    assert(coordinators.length >= 2, 'Need two local coordinator fixtures');
    const administrator = users.find((u) =>
      u.roles.some((r) => ['ROOT', 'ADMIN'].includes(r.code) && r.isEnabled),
    )!;
    assert(administrator);
    const req = {
      ip: '127.0.0.1',
      id: 'inquiry-integration',
    } as unknown as Request;
    const actor = await service.actor(
      {
        id: coordinators[0].id,
        username: coordinators[0].username,
        permissions: [],
      },
      req,
    );
    const other = await service.actor(
      {
        id: coordinators[1].id,
        username: coordinators[1].username,
        permissions: [],
      },
      req,
    );
    const admin = await service.actor(
      {
        id: administrator.id,
        username: administrator.username,
        permissions: [],
      },
      req,
    );
    assert(!actor.admin && admin.admin);
    const citiesService = new CitiesService(
      runner.manager.getRepository(CityEntity),
      scoped,
    );
    const city = await citiesService.create(
      {
        name: 'Numbering integration city',
        province: '',
        status: ResourceStatus.Enabled,
      },
      actor.id,
    );
    assert.match(city.code, /^CITY-\d{8}-\d{2,}$/);
    const updatedCity = await citiesService.update(
      city.id,
      {
        name: city.name,
        province: '',
        status: ResourceStatus.Enabled,
        version: city.version,
      },
      actor.id,
    );
    assert.equal(updatedCity.code, city.code);
    const agencies = await runner.manager.find(AgencyEntity, {
      relations: { contacts: true },
    });
    const agency = agencies.find(
      (a) => a.status === ResourceStatus.Enabled && a.contacts.length,
    )!;
    assert(agency, 'Need agency and contact fixtures');
    const input: InquiryInput = {
      agencyId: agency.id,
      contactId: agency.contacts[0].id,
      sourceChannel: 'Email',
      originalMessage: 'Integration check - rolled back',
      internalRemark: '',
      plannedDays: 2,
      nextFollowUpAt: null,
      lostReason: '',
    };
    let inquiry = await service.create(input, actor);
    assert.match(inquiry.code, /^INQ-\d{8}-\d{2,}$/);
    assert.equal(inquiry.ownerId, actor.id);
    await assert.rejects(service.detail(inquiry.id, other), {
      code: 'INQUIRY_NOT_FOUND',
    });
    await assert.rejects(
      service.create({ ...input, ownerId: other.id }, actor),
      { code: 'INQUIRY_OWNER_INVALID' },
    );
    assert.equal((await service.detail(inquiry.id, admin)).id, inquiry.id);
    const inquiryQuery = Object.assign(new InquiryQuery(), {
      code: inquiry.code.toLowerCase(),
    });
    assert.equal((await service.list(inquiryQuery, other)).total, 0);
    assert.equal((await service.list(inquiryQuery, actor)).total, 1);
    assert.equal(
      (
        await service.list(
          Object.assign(new InquiryQuery(), { code: inquiry.code + '0' }),
          actor,
        )
      ).total,
      0,
    );
    const hotels = await runner.manager.find(HotelEntity);
    const hotel = hotels.find((h) => h.status === ResourceStatus.Enabled)!;
    assert(hotel);
    const vehicles = await runner.manager.find(TransportEntity);
    const vehicle = vehicles.find(
      (v) => v.status === ResourceStatus.Enabled && v.seats >= 3,
    )!;
    assert(vehicle);
    const meals = await runner.manager.find(RestaurantPriceEntity, {
      relations: { restaurant: true },
    });
    const meal = meals.find(
      (p) => p.restaurant?.status === ResourceStatus.Enabled,
    )!;
    assert(meal);
    const hotelTier =
      hotel.rating === 'international_five_star'
        ? 'international_five_star'
        : 'preferred_non_five_star';
    const vehicleTier = vehicle.serviceLevel as 'standard' | 'vip';
    const plan: ItineraryInput = {
      title: 'Integration trip',
      startDate: '2026-10-01',
      adults: 2,
      childrenCount: 1,
      destinations: [hotel.city],
      dailyPlans: [
        {
          id: 'day-one',
          dayNumber: 1,
          date: '2026-10-01',
          departure: '',
          destination: '',
          overnightDestination: hotel.city,
          meals: { breakfast: false, lunch: true, dinner: false },
          transport: '',
          description: 'Arrival',
          items: [
            {
              id: 'meal-one',
              type: 'restaurant',
              mealSlot: 'lunch',
              resourceId: meal.restaurantId,
              resourcePriceId: meal.id,
              resourceName: 'spoofed name',
              priceName: 'spoofed',
              quantity: 3,
              unit: 'spoofed',
              unitCost: 1,
              totalCost: 3,
              remark: '',
            },
          ],
        },
        {
          id: 'day-two',
          dayNumber: 2,
          date: '2026-10-02',
          departure: '',
          destination: '',
          overnightDestination: '',
          meals: { breakfast: false, lunch: false, dinner: false },
          transport: '',
          description: 'Departure',
          items: [],
        },
      ],
      hotelPlans: [
        {
          tier: hotelTier,
          hotels: [
            {
              destination: hotel.city,
              hotelId: hotel.id,
              hotelName: 'spoofed',
              rating: hotel.rating,
              breakfastIncluded: false,
              breakfast: '',
              unit: '',
              unitCost: 1,
            },
          ],
        },
      ],
      vehiclePlans: [
        {
          tier: vehicleTier,
          vehicle: {
            vehicleId: vehicle.id,
            vehicleName: '',
            seats: 1000,
            serviceDays: 2,
            unit: '',
            referenceUnitCost: 1,
            unitCost: 200,
          },
        },
      ],
      guidePlans: [],
      quote: {
        options: [
          {
            id: 'option-one',
            hotelTier,
            vehicleTier,
            adultUnitPrice: 1000,
            leaderFocEnabled: true,
          },
        ],
        chineseTip: null,
        englishTip: null,
        transportFees: [],
        customerNotes: '',
        holidayRestrictions: '',
        hotelReplacementTerms: '',
      },
    };
    let saved = await service.createItinerary(inquiry.id, plan, actor);
    assert.equal(saved.dailyPlans[0].items[0].unitCost, Number(meal.price));
    assert.equal(saved.hotelPlans[0].hotels[0].hotelName, hotel.name);
    await assert.rejects(service.itinerary(saved.id, other), {
      code: 'INQUIRY_NOT_FOUND',
    });
    const changed = structuredClone(saved);
    changed.dailyPlans[0].description = 'New arrival details';
    changed.dailyPlans[0].items[0].quantity = 4;
    changed.vehiclePlans[0].vehicle!.unitCost = 250;
    const {
      title,
      startDate,
      adults,
      childrenCount,
      destinations,
      dailyPlans,
      hotelPlans,
      vehiclePlans,
      guidePlans,
      quote,
    } = changed;
    saved = await service.saveItinerary(
      saved.id,
      {
        title,
        startDate,
        adults,
        childrenCount,
        destinations,
        dailyPlans,
        hotelPlans,
        vehiclePlans,
        guidePlans,
        quote,
        version: saved.version,
      },
      actor,
    );
    const logsQuery = Object.assign(new LogQuery(), {
      inquiryId: inquiry.id,
      pageSize: 1,
    });
    const allQuery = Object.assign(new LogQuery(), { inquiryId: inquiry.id });
    let details = await service.logs(allQuery, actor);
    const edited = details.list.find((l) => l.action === 'itinerary_saved')!;
    assert(edited.changes.some((c) => c.path.endsWith('.description')));
    assert(edited.changes.some((c) => c.path.endsWith('.quantity')));
    assert(edited.changes.some((c) => c.path.endsWith('.unitCost')));
    await assert.rejects(
      service.saveItinerary(
        saved.id,
        {
          title,
          startDate,
          adults,
          childrenCount,
          destinations,
          dailyPlans,
          hotelPlans,
          vehiclePlans,
          guidePlans,
          quote,
          version: saved.version - 1,
        },
        actor,
      ),
      { code: 'ITINERARY_VERSION_CONFLICT' },
    );
    const countBeforePreview = details.total;
    const preview = await service.pdfData(saved.id, actor);
    assert.equal(
      (await service.logs(allQuery, actor)).total,
      countBeforePreview,
    );
    const confirmed = await service.confirmPdf(
      saved.id,
      {
        version: preview.itinerary.version,
        inquiryVersion: preview.inquiryVersion,
      },
      actor,
    );
    assert.equal(confirmed.calculation.options[0].totalPrice, 2700);
    assert.equal(confirmed.calculation.options[0].childUnitPrice, 700);
    const repeat = await service.confirmPdf(
      saved.id,
      {
        version: preview.itinerary.version,
        inquiryVersion: preview.inquiryVersion,
      },
      actor,
    );
    assert.equal(repeat.generatedAt, confirmed.generatedAt);
    assert.equal(
      (await service.logs(allQuery, actor)).list.filter(
        (l) => l.action === 'itinerary_pdf_generated',
      ).length,
      1,
    );
    await runner.manager.update(HotelEntity, hotel.id, {
      individualPrice: '999999.00',
    });
    assert.deepEqual(
      (await service.pdfData(saved.id, actor)).calculation,
      confirmed.calculation,
    );
    saved = await service.itinerary(saved.id, actor);
    await assert.rejects(
      service.saveItinerary(
        saved.id,
        { ...plan, version: saved.version },
        actor,
      ),
      { code: 'ITINERARY_READ_ONLY' },
    );
    const copy = await service.copy(
      saved.id,
      { version: saved.version, title: 'Copied trip' },
      actor,
    );
    assert.notEqual(copy.dailyPlans[0].id, saved.dailyPlans[0].id);
    assert.equal(copy.status, 'draft');
    inquiry = await service.detail(inquiry.id, actor);
    assert.equal(inquiry.status, 'planning');
    await service.update(
      inquiry.id,
      {
        ...input,
        originalMessage: 'Changed and lost',
        status: 'lost',
        lostReason: 'Budget',
        version: inquiry.version,
      },
      actor,
    );
    details = await service.logs(allQuery, actor);
    assert.equal(
      details.list.filter((l) => l.action === 'inquiry_lost').length,
      1,
    );
    assert.equal(
      details.list.filter((l) => l.action === 'inquiry_updated').length,
      0,
    );
    assert(
      details.list
        .find((l) => l.action === 'inquiry_lost')!
        .changes.some((c) => c.path === 'originalMessage'),
    );
    await assert.rejects(service.logs(allQuery, other), {
      code: 'INQUIRY_NOT_FOUND',
    });
    await assert.rejects(service.report(allQuery, other), {
      code: 'INQUIRY_NOT_FOUND',
    });
    const summary = await service.report(logsQuery, actor);
    assert.equal(summary.totalOperations, 6);
    const byCode = Object.assign(new LogQuery(), {
      inquiryCode: inquiry.code.toLowerCase(),
    });
    assert.equal((await service.logs(byCode, actor)).total, 6);
    assert.equal((await service.report(byCode, actor)).totalOperations, 6);
    assert.equal((await service.report(byCode, other)).totalOperations, 0);
    assert.equal(
      (
        await service.report(
          Object.assign(new LogQuery(), { inquiryCode: 'NO-SUCH-CODE' }),
          admin,
        )
      ).totalOperations,
      0,
    );
    assert.equal(summary.inquiryCount, 1);
    assert.equal(summary.operatorCount, 1);
    assert.equal((await service.logs(logsQuery, actor)).list.length, 1);
    assert.equal(
      summary.byAction.find((a) => a.action === 'itinerary_created')!.count,
      2,
    );
    const filtered = await service.report(
      Object.assign(new LogQuery(), {
        inquiryId: inquiry.id,
        action: 'itinerary_saved',
        from: '2000-01-01',
        to: '2100-01-01',
        operatorId: actor.id,
      }),
      admin,
    );
    assert.equal(filtered.totalOperations, 1);
    assert((await service.operators(actor)).some((p) => p.id === actor.id));
    console.log(
      JSON.stringify({
        result: 'passed',
        operations: summary.totalOperations,
        changedFields: summary.changedFields,
        checks: [
          'scope',
          'owner assignment',
          'resource snapshots',
          'field deltas',
          'stale version',
          'PDF preview',
          'frozen pricing',
          'idempotent confirmation',
          'copy IDs',
          'lost single event',
          'full report',
          'date/operator filters',
        ],
        fixtures: 'rolled back',
      }),
    );
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await db.destroy();
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
