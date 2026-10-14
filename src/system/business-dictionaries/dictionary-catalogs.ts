import * as countries from 'i18n-iso-countries';

// Catalog source: ISO 3166-1 via i18n-iso-countries (version in package.json).
countries.registerLocale(
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('i18n-iso-countries/langs/en.json') as countries.LocaleData,
);
countries.registerLocale(
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('i18n-iso-countries/langs/zh.json') as countries.LocaleData,
);

export interface CatalogEntry {
  code: string;
  name: string;
  englishName: string;
}

// Display names differing from the library's Chinese names are business-approved.
const COUNTRY_NAMES: Record<string, string> = {
  TWN: '中国台湾省',
  HKG: '中国香港',
  IDN: '印度尼西亚',
};

export const CATALOG_TYPES = ['country-region', 'city-airport'] as const;
export type CatalogType = (typeof CATALOG_TYPES)[number];

const first = (value: string | string[] | undefined): string =>
  (typeof value === 'string' ? value : value?.[0]) ?? '';

let countryCache: CatalogEntry[] | null = null;

export function countryCatalog(): CatalogEntry[] {
  if (!countryCache) {
    countryCache = Object.keys(countries.getAlpha3Codes())
      .map((code) => {
        const alpha2 = countries.alpha3ToAlpha2(code) ?? '';
        const zh: string | string[] | undefined = countries.getName(
          alpha2,
          'zh',
        );
        const en: string | string[] | undefined = countries.getName(
          alpha2,
          'en',
        );
        return {
          code,
          name: COUNTRY_NAMES[code] ?? first(zh),
          englishName: first(en),
        };
      })
      .filter((entry) => entry.name && entry.englishName)
      .sort((a, b) => a.code.localeCompare(b.code));
  }
  return countryCache;
}

// Curated, operating civil passenger airports relevant to current flights.
// Operator/CAAC evidence and IATA cross-checks: root docs verification 2026-10-09.
export const AIRPORT_CATALOG: CatalogEntry[] = [
  ['SHA', '上海虹桥国际机场', 'Shanghai Hongqiao International Airport'],
  ['PVG', '上海浦东国际机场', 'Shanghai Pudong International Airport'],
  ['PEK', '北京首都国际机场', 'Beijing Capital International Airport'],
  ['PKX', '北京大兴国际机场', 'Beijing Daxing International Airport'],
  ['CTU', '成都双流国际机场', 'Chengdu Shuangliu International Airport'],
  ['TFU', '成都天府国际机场', 'Chengdu Tianfu International Airport'],
  ['CAN', '广州白云国际机场', 'Guangzhou Baiyun International Airport'],
  ['SZX', '深圳宝安国际机场', "Shenzhen Bao'an International Airport"],
  ['KMG', '昆明长水国际机场', 'Kunming Changshui International Airport'],
  ['LJG', '丽江三义国际机场', 'Lijiang Sanyi International Airport'],
  ['DIG', '香格里拉迪庆香格里拉机场', 'Shangri-La Diqing Shangri-La Airport'],
  ['XMN', '厦门高崎国际机场', 'Xiamen Gaoqi International Airport'],
  ['HGH', '杭州萧山国际机场', 'Hangzhou Xiaoshan International Airport'],
  ['WUH', '武汉天河国际机场', 'Wuhan Tianhe International Airport'],
  ['FOC', '福州长乐国际机场', 'Fuzhou Changle International Airport'],
  ['CKG', '重庆江北国际机场', 'Chongqing Jiangbei International Airport'],
  ['HKG', '香港国际机场', 'Hong Kong International Airport'],
  ['BKK', '曼谷素万那普国际机场', 'Bangkok Suvarnabhumi Airport'],
  ['DMK', '曼谷廊曼国际机场', 'Bangkok Don Mueang International Airport'],
  ['RGN', '仰光国际机场', 'Yangon International Airport'],
  ['MDL', '曼德勒国际机场', 'Mandalay International Airport'],
  ['KTI', '金边德崇国际机场', 'Phnom Penh Techo International Airport'],
  ['SIN', '新加坡樟宜机场', 'Singapore Changi Airport'],
  ['BWN', '文莱国际机场', 'Bandar Seri Begawan Brunei International Airport'],
  ['JHB', '新山士乃国际机场', 'Johor Bahru Senai International Airport'],
  ['PEN', '槟城国际机场', 'Penang International Airport'],
  ['KUL', '吉隆坡国际机场', 'Kuala Lumpur International Airport'],
  [
    'SZB',
    '吉隆坡梳邦苏丹阿都阿兹沙机场',
    'Kuala Lumpur Subang Sultan Abdul Aziz Shah Airport',
  ],
].map(([code, name, englishName]) => ({ code, name, englishName }));

export function catalogFor(type: string): CatalogEntry[] | null {
  if (type === 'country-region') return countryCatalog();
  if (type === 'city-airport') return AIRPORT_CATALOG;
  return null;
}

/** Finds the catalog entry whose code and English name both match. */
export function matchCatalog(
  type: string,
  code: string,
  englishName: string,
): CatalogEntry | null {
  const entry = catalogFor(type)?.find((item) => item.code === code);
  return entry && entry.englishName === englishName ? entry : null;
}
