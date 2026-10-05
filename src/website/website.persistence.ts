import type { EntityManager } from 'typeorm';
import type {
  WebsiteDay,
  WebsiteHotelStay,
  WebsiteItem,
  WebsiteLeg,
  WebsiteMeal,
  WebsiteService,
  WebsiteVehiclePrice,
} from './website.types';

type DayRow = Omit<
  WebsiteDay,
  'items' | 'legs' | 'hotels' | 'meals' | 'services'
>;
interface DetailRow<T> {
  dayId: string;
  value: T;
}

export async function loadWebsiteDetails(
  manager: EntityManager,
  itineraryId: string,
) {
  const days = await manager.query<DayRow[]>(
    `SELECT id,day_number AS "dayNumber",
    depart_city_id AS "departCityId",end_city_id AS "endCityId",overnight_city_id AS "overnightCityId",
    guide_language AS "guideLanguage",guide_scope AS "guideScope" FROM website_days
    WHERE itinerary_id=$1 ORDER BY day_number`,
    [itineraryId],
  );
  const dayIds = days.map((d) => d.id);
  // Transactional managers share one PostgreSQL connection; read sequentially.
  const items = await manager.query<DetailRow<WebsiteItem>[]>(
    `SELECT day_id AS "dayId",json_build_object(
      'id',id,'attractionId',attraction_id,'nameZh',name_zh,'nameEn',name_en,
      'descriptionZh',description_zh,'descriptionEn',description_en,'appears',appears,'feeState',fee_state
      ) AS value FROM website_items WHERE day_id=ANY($1::uuid[]) ORDER BY position`,
    [dayIds],
  );
  const legs = await manager.query<DetailRow<WebsiteLeg>[]>(
    `SELECT day_id AS "dayId",json_build_object(
      'id',id,'routeId',route_id,'fromCityId',from_city_id,'toCityId',to_city_id,'mode',mode,
      'nameZh',name_zh,'nameEn',name_en,'feeState',fee_state
      ) AS value FROM website_legs WHERE day_id=ANY($1::uuid[]) ORDER BY position`,
    [dayIds],
  );
  const hotels = await manager.query<DetailRow<WebsiteHotelStay>[]>(
    `SELECT day_id AS "dayId",json_build_object(
      'id',id,'tier',tier,'cityId',city_id,'resourceId',resource_id,'nameZh',name_zh,'nameEn',name_en,
      'roomType',room_type,'breakfastIncluded',breakfast_included
      ) AS value FROM website_hotels WHERE day_id=ANY($1::uuid[]) ORDER BY position`,
    [dayIds],
  );
  const meals = await manager.query<DetailRow<WebsiteMeal>[]>(
    `SELECT day_id AS "dayId",json_build_object(
      'id',id,'slot',slot,'resourceId',resource_id,'restaurantZh',restaurant_zh,'restaurantEn',restaurant_en,'feeState',fee_state
      ) AS value FROM website_meals WHERE day_id=ANY($1::uuid[]) ORDER BY position`,
    [dayIds],
  );
  const services = await manager.query<DetailRow<WebsiteService>[]>(
    `SELECT day_id AS "dayId",json_build_object(
      'id',id,'nameZh',name_zh,'nameEn',name_en,'appears',appears,'feeState',fee_state
      ) AS value FROM website_services WHERE day_id=ANY($1::uuid[]) ORDER BY position`,
    [dayIds],
  );
  const vehiclePrices = await manager.query<WebsiteVehiclePrice[]>(
    `SELECT vehicle_type AS "vehicleType",unit_price::text AS "unitPrice"
      FROM website_vehicle_prices WHERE itinerary_id=$1 ORDER BY CASE vehicle_type
        WHEN '5_seat' THEN 1 WHEN '7_seat' THEN 2 WHEN '9_seat' THEN 3 WHEN '14_seat' THEN 4 ELSE 5 END`,
    [itineraryId],
  );
  const forDay = <T>(rows: DetailRow<T>[], id: string) =>
    rows.filter((r) => r.dayId === id).map((r) => r.value);
  return {
    days: days.map((day) => ({
      ...day,
      items: forDay(items, day.id),
      legs: forDay(legs, day.id),
      hotels: forDay(hotels, day.id),
      meals: forDay(meals, day.id),
      services: forDay(services, day.id),
    })),
    vehiclePrices,
  };
}

async function insertRows(
  manager: EntityManager,
  table: string,
  columns: string[],
  rows: unknown[][],
) {
  // Tables and columns are internal constants; all business values remain parameters.
  const chunkSize = 500;
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const batch = rows.slice(offset, offset + chunkSize);
    const placeholders = batch
      .map(
        (row, index) =>
          `(${row.map((_, column) => `$${index * columns.length + column + 1}`).join(',')})`,
      )
      .join(',');
    await manager.query(
      `INSERT INTO ${table}(${columns.join(',')}) VALUES ${placeholders}`,
      batch.flat(),
    );
  }
}

export async function saveWebsiteDetails(
  manager: EntityManager,
  itineraryId: string,
  days: WebsiteDay[],
  prices: WebsiteVehiclePrice[],
) {
  await manager.query('DELETE FROM website_days WHERE itinerary_id=$1', [
    itineraryId,
  ]);
  await manager.query(
    'DELETE FROM website_vehicle_prices WHERE itinerary_id=$1',
    [itineraryId],
  );
  await insertRows(
    manager,
    'website_days',
    [
      'id',
      'itinerary_id',
      'day_number',
      'depart_city_id',
      'end_city_id',
      'overnight_city_id',
      'guide_language',
      'guide_scope',
    ],
    days.map((d) => [
      d.id,
      itineraryId,
      d.dayNumber,
      d.departCityId,
      d.endCityId,
      d.overnightCityId,
      d.guideLanguage,
      d.guideScope,
    ]),
  );
  await insertRows(
    manager,
    'website_items',
    [
      'id',
      'day_id',
      'position',
      'attraction_id',
      'name_zh',
      'name_en',
      'description_zh',
      'description_en',
      'appears',
      'fee_state',
    ],
    days.flatMap((d) =>
      d.items.map((i, n) => [
        i.id,
        d.id,
        n,
        i.attractionId,
        i.nameZh,
        i.nameEn,
        i.descriptionZh,
        i.descriptionEn,
        i.appears,
        i.feeState,
      ]),
    ),
  );
  await insertRows(
    manager,
    'website_legs',
    [
      'id',
      'day_id',
      'position',
      'route_id',
      'from_city_id',
      'to_city_id',
      'mode',
      'name_zh',
      'name_en',
      'fee_state',
    ],
    days.flatMap((d) =>
      d.legs.map((i, n) => [
        i.id,
        d.id,
        n,
        i.routeId,
        i.fromCityId,
        i.toCityId,
        i.mode,
        i.nameZh,
        i.nameEn,
        i.feeState,
      ]),
    ),
  );
  await insertRows(
    manager,
    'website_hotels',
    [
      'id',
      'day_id',
      'position',
      'tier',
      'city_id',
      'resource_id',
      'name_zh',
      'name_en',
      'room_type',
      'breakfast_included',
    ],
    days.flatMap((d) =>
      d.hotels.map((i, n) => [
        i.id,
        d.id,
        n,
        i.tier,
        i.cityId,
        i.resourceId,
        i.nameZh,
        i.nameEn,
        i.roomType,
        i.breakfastIncluded,
      ]),
    ),
  );
  await insertRows(
    manager,
    'website_meals',
    [
      'id',
      'day_id',
      'position',
      'slot',
      'resource_id',
      'restaurant_zh',
      'restaurant_en',
      'fee_state',
    ],
    days.flatMap((d) =>
      d.meals.map((i, n) => [
        i.id,
        d.id,
        n,
        i.slot,
        i.resourceId,
        i.restaurantZh,
        i.restaurantEn,
        i.feeState,
      ]),
    ),
  );
  await insertRows(
    manager,
    'website_services',
    ['id', 'day_id', 'position', 'name_zh', 'name_en', 'appears', 'fee_state'],
    days.flatMap((d) =>
      d.services.map((i, n) => [
        i.id,
        d.id,
        n,
        i.nameZh,
        i.nameEn,
        i.appears,
        i.feeState,
      ]),
    ),
  );
  await insertRows(
    manager,
    'website_vehicle_prices',
    ['itinerary_id', 'vehicle_type', 'unit_price'],
    prices.map((p) => [itineraryId, p.vehicleType, p.unitPrice]),
  );
}
