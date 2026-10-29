import type {
  WebsitePriceComponent,
  WebsiteVehiclePriceInput,
  WebsiteDay,
  WebsiteHotelTier,
  WebsiteQuotationOptions,
} from './website.types';

export const WEBSITE_PRICE_CATEGORIES = [
  'hotel',
  'guide',
  'vehicle',
  'attraction',
  'meal',
] as const;

/** Sum customer prices in integer cents; visibility never changes the total. */
export function componentUnitPrice(
  components: WebsitePriceComponent[],
): string | null {
  const amounts = components.filter((row) => row.unitPrice !== null);
  if (!amounts.length) return null;
  const cents = amounts.reduce((total, row) => {
    if (!/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(row.unitPrice!))
      throw new Error('Invalid component amount');
    const [whole, fraction = ''] = row.unitPrice!.split('.');
    return total + BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  }, 0n);
  if (cents > 999999999999n)
    throw new Error('Component total exceeds price limit');
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}

export function normalizeVehiclePrice<T extends WebsiteVehiclePriceInput>(
  price: T,
): T {
  const components = price.priceComponents ?? [];
  if (components.length === 0) return { ...price, priceComponents: [] };
  if (
    components.length !== 5 ||
    new Set(components.map((row) => row.category)).size !== 5 ||
    components.some((row) => !WEBSITE_PRICE_CATEGORIES.includes(row.category))
  )
    throw new Error('All five price categories are required');
  return {
    ...price,
    priceComponents: WEBSITE_PRICE_CATEGORIES.map((category) =>
      components.find((row) => row.category === category)!,
    ),
    unitPrice: componentUnitPrice(components),
  };
}

export const WEBSITE_HOTEL_TIERS = {
  A: { zh: '高端五星', en: 'Luxury 5-star' },
  B: { zh: '舒适四星', en: 'Comfort 4-star' },
  C: { zh: '经济三星', en: 'Economy 3-star' },
  D: { zh: '二星及以下', en: '2-star and below' },
} as const;

/** Only active itinerary days decide the quotation dimensions and services. */
export function websiteQuotationOptions(
  days: WebsiteDay[],
): WebsiteQuotationOptions {
  const vehicleTypes = [
    ...new Set(
      days.flatMap((day) =>
        day.legs
          .filter(
            (leg) => leg.mode === 'private_vehicle' && leg.vehicleType?.trim(),
          )
          .map((leg) => leg.vehicleType!.trim()),
      ),
    ),
  ];
  const selectedTiers = new Set(
    days
      .filter((day) => day.overnightCityId)
      .flatMap((day) => day.hotels.map((hotel) => hotel.tier)),
  );
  const hotelTiers = (
    Object.keys(WEBSITE_HOTEL_TIERS) as WebsiteHotelTier[]
  ).filter((tier) => selectedTiers.has(tier));
  const driverDays = days
    .filter((day) => day.legs.some((leg) => leg.mode === 'private_vehicle'))
    .map((day) => day.dayNumber);
  return {
    vehicleTypes: vehicleTypes.length ? vehicleTypes : [null],
    hotelTiers: hotelTiers.length ? hotelTiers : [null],
    includesDriver: driverDays.length > 0,
    includesGuide: days.some((day) => !!day.guideLanguage.trim()),
    driverDays,
    guideServices: days
      .filter((day) => day.guideLanguage.trim())
      .map((day) => ({
        dayNumber: day.dayNumber,
        language: day.guideLanguage.trim(),
      })),
  };
}

export function quotationPriceKey(
  price: Pick<WebsiteVehiclePriceInput, 'vehicleType' | 'hotelTier'>,
): string {
  return JSON.stringify([price.vehicleType, price.hotelTier]);
}
