import {
  componentUnitPrice,
  websiteAttractionPriceReference,
  normalizeVehiclePrice,
  WEBSITE_PRICE_CATEGORIES,
} from './website-price';
import type {
  WebsitePriceComponent,
  WebsiteConfig,
  WebsiteDay,
} from './website.types';

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

describe('itinerary attraction price references', () => {
  const config: WebsiteConfig = {
    version: 7,
    cities: [],
    hotels: [],
    routes: [],
    patterns: [],
    skeletons: [],
    templates: [],
    attractions: [
      {
        id: 'paid',
        price: '0.10',
        chargeable: true,
        kind: 'attraction' as const,
      },
      {
        id: 'component',
        price: '0.20',
        chargeable: true,
        kind: 'component' as const,
      },
      { id: 'zero', price: '0', chargeable: true, kind: 'attraction' as const },
      {
        id: 'free',
        price: '999',
        chargeable: false,
        kind: 'attraction' as const,
      },
    ].map((item) => ({
      ...item,
      cityId: 'city',
      parentId: null,
      nameZh: '景点',
      nameEn: 'Attraction',
      resourceId: null,
      status: 'enabled',
      descriptionZh: '说明',
      descriptionEn: 'Copy',
      recommendedMonths: [],
    })),
  };
  function day(ids: Array<string | null>): WebsiteDay {
    return {
      id: 'day',
      dayNumber: 1,
      departCityId: '',
      endCityId: '',
      overnightCityId: null,
      legs: [],
      hotels: [],
      meals: [],
      services: [],
      guideLanguage: '',
      eventOrder: [],
      items: ids.map((attractionId, i) => ({
        id: `item-${i}`,
        attractionId,
        nameZh: '景点',
        nameEn: 'Attraction',
        descriptionZh: '说明',
        descriptionEn: 'Copy',
        appears: i % 2 === 0,
        feeState: i % 2 === 0 ? 'INCLUDED' : 'SELF_PAY',
      })),
    };
  }
  it('counts every charged occurrence, including components and hidden/self-pay items, exactly', () => {
    const days = [
      day(['paid', 'component', 'paid', 'zero', 'free', null, 'unknown']),
    ];
    const before = structuredClone(days);
    const result = websiteAttractionPriceReference(days, config);
    expect(result.configVersion).toBe(7);
    expect(result.total).toBe('0.40');
    expect(result.items.map((item) => item.price)).toEqual([
      '0.10',
      '0.20',
      '0.10',
      '0.00',
      null,
      null,
      null,
    ]);
    expect(result.items.map((item) => item.chargeable)).toEqual([
      true,
      true,
      true,
      true,
      false,
      null,
      null,
    ]);
    expect(days).toEqual(before);
  });
  it('keeps total independent of the editable customer price limit and never uses float addition', () => {
    const expensive = {
      ...config,
      attractions: [{ ...config.attractions[0], price: '9999999999.99' }],
    };
    expect(
      websiteAttractionPriceReference([day(['paid', 'paid'])], expensive).total,
    ).toBe('19999999999.98');
  });
  it('returns an explicit zero total for no charged items or no active days', () => {
    expect(websiteAttractionPriceReference([], config)).toEqual({
      configVersion: 7,
      items: [],
      total: '0.00',
    });
    expect(
      websiteAttractionPriceReference([day(['free', null])], config).total,
    ).toBe('0.00');
  });
});
