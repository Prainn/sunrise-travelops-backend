import { plainToInstance } from 'class-transformer';
import { EntityManager } from 'typeorm';
import { ItineraryInput } from './inquiry.dto';
import { ItineraryEntity } from './inquiry.entity';

// Fixed business tables used by the nested itinerary API.
export const ITINERARY_TABLES = {
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
export const columnName = (name: string) =>
  name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
type Table = keyof typeof ITINERARY_TABLES;
type Row = Record<string, unknown>;
export function itineraryRows(data: ItineraryInput): Record<Table, Row[]> {
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
export async function saveItineraryData(
  manager: EntityManager,
  row: ItineraryEntity,
) {
  const data = row.data;
  await manager.query(
    'UPDATE itineraries SET title=$2,start_date=$3,adults=$4,children_count=$5,leader_count=$6 WHERE id=$1',
    [
      row.id,
      data.title,
      data.startDate,
      data.adults,
      data.childrenCount,
      data.leaderCount,
    ],
  );
  const rows = itineraryRows(data);
  for (const table of Object.keys(ITINERARY_TABLES).reverse() as Table[]) {
    await manager.query(`DELETE FROM ${table} WHERE itinerary_id=$1`, [row.id]);
  }
  for (const table of Object.keys(ITINERARY_TABLES) as Table[]) {
    const fields = Object.keys(ITINERARY_TABLES[table]);
    for (const [position, item] of rows[table].entries()) {
      const values = fields.map((field) => item[field] ?? null);
      await manager.query(
        `INSERT INTO ${table}(itinerary_id,position,${fields.map(columnName).join(',')}) VALUES ($1,$2,${values.map((_, index) => `$${index + 3}`).join(',')})`,
        [row.id, position, ...values],
      );
    }
  }
}
export async function loadItineraryData(
  manager: EntityManager,
  row: ItineraryEntity,
): Promise<ItineraryEntity> {
  const rows = {} as Record<Table, Row[]>;
  for (const table of Object.keys(ITINERARY_TABLES) as Table[]) {
    const fields = Object.entries(ITINERARY_TABLES[table]);
    const records = await manager.query<Row[]>(
      `SELECT * FROM ${table} WHERE itinerary_id=$1 ORDER BY position`,
      [row.id],
    );
    rows[table] = records.map((record) =>
      Object.fromEntries(
        fields.map(([key, type]) => {
          const value = record[columnName(key)];
          return [
            key,
            value != null &&
            (type.startsWith('numeric') || type.startsWith('integer'))
              ? Number(value)
              : value,
          ];
        }),
      ),
    );
  }
  const omit = (r: Row, keys: string[]) =>
    Object.fromEntries(
      Object.entries(r).filter(([key]) => !keys.includes(key)),
    );
  // The shape is assembled exclusively from the declared columns above.
  row.data = plainToInstance(ItineraryInput, {
    title: row.title,
    startDate: row.startDate,
    adults: row.adults,
    childrenCount: row.childrenCount,
    leaderCount: row.leaderCount,
    destinations: rows.itinerary_destinations.map((r) => r.destination),
    dailyPlans: rows.itinerary_days.map((d) => ({
      ...omit(d, ['breakfast', 'lunch', 'dinner']),
      meals: { breakfast: d.breakfast, lunch: d.lunch, dinner: d.dinner },
      items: rows.itinerary_items
        .filter((i) => i.dayId === d.id)
        .map((i) => omit(i, ['dayId'])),
    })),
    hotelPlans: rows.itinerary_hotel_plans.map((p) => ({
      tier: p.tier,
      hotels: rows.itinerary_hotels
        .filter((h) => h.tier === p.tier)
        .map((h) => omit(h, ['tier'])),
    })),
    vehiclePlans: rows.itinerary_vehicle_plans.map((p) => ({
      ...p,
      arrangements: rows.itinerary_vehicle_ranges
        .filter((a) => a.tier === p.tier)
        .map((a) => ({
          ...omit(a, ['tier']),
          vehicles: rows.itinerary_vehicles
            .filter((v) => v.tier === p.tier && v.rangeId === a.id)
            .map((v) => omit(v, ['tier', 'rangeId'])),
        })),
    })),
    guidePlans: rows.itinerary_guides,
    quote: {
      ...rows.itinerary_quote_settings[0],
      options: rows.itinerary_quote_options,
      transportFees: rows.itinerary_transport_fees,
    },
  });
  return row;
}
