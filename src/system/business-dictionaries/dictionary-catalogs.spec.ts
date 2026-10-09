import {
  AIRPORT_CATALOG,
  countryCatalog,
  matchCatalog,
} from './dictionary-catalogs';

describe('dictionary catalogs', () => {
  it('validates country code and English name together', () => {
    expect(countryCatalog().length).toBeGreaterThan(240);
    expect(
      matchCatalog(
        'country-region',
        'CHN',
        countryCatalog().find((c) => c.code === 'CHN')!.englishName,
      ),
    ).toMatchObject({ code: 'CHN' });
    expect(matchCatalog('country-region', 'ZZZ', 'Nowhere')).toBeNull();
    expect(matchCatalog('country-region', 'CHN', 'Malaysia')).toBeNull();
  });

  it('keeps one IATA code per airport with city and airport in English', () => {
    const codes = AIRPORT_CATALOG.map((a) => a.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((c) => /^[A-Z]{3}$/.test(c))).toBe(true);
  });
});
