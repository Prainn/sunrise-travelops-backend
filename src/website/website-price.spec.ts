import {
  componentUnitPrice,
  normalizeVehiclePrice,
  WEBSITE_PRICE_CATEGORIES,
} from './website-price';
import type { WebsitePriceComponent } from './website.types';

const components = (amounts: (string | null)[]): WebsitePriceComponent[] =>
  WEBSITE_PRICE_CATEGORIES.map((category, index) => ({
    category,
    unitPrice: amounts[index],
    showInPdf: index === 0,
  }));
describe('customer price components', () => {
  it('sums every component in cents regardless of PDF visibility', () => {
    expect(
      componentUnitPrice(components(['2000', '1000', '3000', '2000', '2000'])),
    ).toBe('10000.00');
    expect(
      componentUnitPrice(components(['0.10', '0.20', null, null, null])),
    ).toBe('0.30');
    expect(componentUnitPrice(components(['0', null, null, null, null]))).toBe(
      '0.00',
    );
    expect(
      componentUnitPrice(components([null, null, null, null, null])),
    ).toBeNull();
  });
  it('rejects invalid amounts, overflowing totals, and duplicate or missing categories', () => {
    for (const value of ['-1', '01', '1.001', '1e3', 'NaN'])
      expect(() =>
        componentUnitPrice(components([value, null, null, null, null])),
      ).toThrow();
    expect(() =>
      componentUnitPrice(
        components(['9999999999.99', '0.01', null, null, null]),
      ),
    ).toThrow();
    const price = {
      vehicleType: '7_seat' as const,
      hotelTier: 'A' as const,
      includesDriver: false,
      includesGuide: false,
      unitPrice: '1',
      priceComponents: components(['1', '2', '3', '4', '5']),
    };
    expect(normalizeVehiclePrice(price).unitPrice).toBe('15.00');
    expect(() =>
      normalizeVehiclePrice({
        ...price,
        priceComponents: price.priceComponents.slice(1),
      }),
    ).toThrow();
    expect(() =>
      normalizeVehiclePrice({
        ...price,
        priceComponents: Array(5).fill(price.priceComponents[0]),
      }),
    ).toThrow();
    expect(
      normalizeVehiclePrice({ ...price, priceComponents: [] }).unitPrice,
    ).toBe('1');
  });
});
