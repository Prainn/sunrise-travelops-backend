import type {
  WebsitePriceComponent,
  WebsiteVehiclePrice,
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

export function normalizeVehiclePrice(
  price: WebsiteVehiclePrice,
): WebsiteVehiclePrice {
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
