import {
  AIRPORT_CATALOG,
  countryCatalog,
  matchCatalog,
  UNKNOWN_COUNTRY,
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

  it('allows only the reserved UNKNOWN country with its exact catalog names', () => {
    expect(countryCatalog()[0]).toEqual({
      code: 'UNKNOWN',
      name: '未知/待确认',
      englishName: 'Unknown / To be confirmed',
    });
    expect(
      matchCatalog('country-region', 'UNKNOWN', UNKNOWN_COUNTRY.englishName),
    ).toEqual(UNKNOWN_COUNTRY);
    expect(matchCatalog('country-region', 'UNKNOWN', 'Unknown')).toBeNull();
    expect(
      matchCatalog('country-region', 'UNKNOW', UNKNOWN_COUNTRY.englishName),
    ).toBeNull();
    expect(
      matchCatalog('city-airport', 'UNKNOWN', UNKNOWN_COUNTRY.englishName),
    ).toBeNull();
    expect(new Set(countryCatalog().map((item) => item.code)).size).toBe(
      countryCatalog().length,
    );
  });
});
