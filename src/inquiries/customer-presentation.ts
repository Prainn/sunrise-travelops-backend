import type { EntityManager } from 'typeorm';
import type { InquiryEntity, CurrentPdfData } from './inquiry.entity';
import type { ItineraryInput } from './inquiry.dto';
import { dateAt } from './itinerary-validation';

interface NamedResource {
  id: string;
  name: string;
  englishName: string;
  description?: string;
  englishDescription?: string;
}
interface CustomerDay {
  id: string;
  dayNumber: number;
  date: string;
  route: string[];
  transport: string;
  description: string;
  overnightDestination: string;
  meals: { breakfast: boolean; lunch: boolean; dinner: boolean };
  items: {
    id: string;
    name: string;
    description: string;
    remark: string;
    unit: string;
  }[];
}
interface CustomerContent {
  title: string;
  country: string;
  days: CustomerDay[];
  hotels: { hotelId: string; name: string; destination: string }[];
  notes: string[];
  transportFees: { id: string; departureCity: string; arrivalCity: string }[];
  returnArrival: { dayNumber: number; date: string; text: string } | null;
}
export interface CustomerPresentation {
  version: 1;
  serviceDays: number;
  displayDays: number;
  accommodationNights: number;
  noAccommodation: boolean;
  missingEnglish: string[];
  zh: CustomerContent;
  en: CustomerContent;
}

/** Resolve mutable resources once; frozen reads never invoke this function. Brand artwork stays unchanged. */
export async function buildCustomerPresentation(
  manager: EntityManager,
  plan: ItineraryInput,
  inquiry: InquiryEntity,
): Promise<CustomerPresentation> {
  const cityNames = [
    ...new Set([
      ...plan.destinations,
      ...plan.dailyPlans.flatMap((d) => [
        d.departure,
        ...(d.viaDestinations ?? []),
        d.destination,
        d.overnightDestination ?? '',
      ]),
      ...plan.quote.transportFees.flatMap((f) => [
        f.departureCity,
        f.arrivalCity,
      ]),
    ]),
  ].filter(Boolean);
  const cities = await manager.query<{ name: string; englishName: string }[]>(
    `SELECT name,english_name AS "englishName" FROM resource_cities WHERE name=ANY($1::text[]) AND deleted_at IS NULL`,
    [cityNames],
  );
  const cityMap = new Map(cities.map((c) => [c.name, c.englishName]));
  const items = plan.dailyPlans.flatMap((d) => d.items);
  const resourceMap = new Map<string, NamedResource>();
  for (const kind of ['attraction', 'restaurant', 'hotel'] as const) {
    const ids =
      kind === 'hotel'
        ? plan.hotelPlans.flatMap((p) => p.hotels.map((h) => h.hotelId))
        : items
            .filter((i) => i.type === kind && i.resourceId)
            .map((i) => i.resourceId!);
    if (!ids.length) continue;
    const table = {
      attraction: 'resource_attractions',
      restaurant: 'resource_restaurants',
      hotel: 'resource_hotels',
    }[kind];
    const rows = await manager.query<NamedResource[]>(
      `SELECT id,name,english_name AS "englishName"${kind === 'hotel' ? '' : ',description,english_description AS "englishDescription"'} FROM ${table} WHERE id=ANY($1::uuid[])`,
      [ids],
    );
    for (const r of rows) resourceMap.set(`${kind}:${r.id}`, r);
  }
  const dictionaries = await manager.query<
    {
      id: string;
      code: string;
      name: string;
      englishName: string;
      type: string;
    }[]
  >(
    `SELECT i.id,i.code,i.name,i.english_name AS "englishName",t.code AS type FROM system_business_dictionary_items i JOIN system_business_dictionary_types t ON t.id=i.type_id WHERE (t.code IN ('transport-method','resource-unit') OR i.id=$1::uuid) AND i.deleted_at IS NULL`,
    [inquiry.countryItemId],
  );
  const missing = new Set<string>();
  const english = (
    value: string | undefined,
    path: string,
    required = true,
  ) => {
    const text = value?.trim() ?? '';
    if (required && (!text || /\p{Script=Han}/u.test(text))) missing.add(path);
    return text;
  };
  const city = (name: string, override: string | undefined, path: string) =>
    !name
      ? ''
      : english(cityMap.has(name) ? cityMap.get(name) : override, path);
  const content = (lang: 'zh' | 'en'): CustomerContent => {
    const en = lang === 'en';
    return {
      title: en ? english(plan.titleEn, 'titleEn') : plan.title,
      country: en
        ? english(
            dictionaries.find((d) => d.id === inquiry.countryItemId)
              ?.englishName,
            'country.englishName',
            !!inquiry.countryOrRegion,
          )
        : inquiry.countryOrRegion,
      days: plan.dailyPlans.map((d) => {
        const p = `dailyPlans[${d.id}]`;
        const route = en
          ? [
              city(d.departure, undefined, `${p}.departureEn`),
              ...(d.viaDestinations ?? []).map((c) =>
                city(c, undefined, `cities[${c}].englishName`),
              ),
              city(d.destination, undefined, `${p}.destinationEn`),
            ]
          : [d.departure, ...(d.viaDestinations ?? []), d.destination];
        const transport = d.transport
          .split(',')
          .filter(Boolean)
          .map((code) => {
            const dict = dictionaries.find(
              (i) => i.type === 'transport-method' && i.code === code,
            );
            return en
              ? english(dict?.englishName, `${p}.transportEn`)
              : (dict?.name ?? code);
          })
          .filter(Boolean)
          .join(' / ');
        return {
          id: d.id,
          dayNumber: d.dayNumber,
          date: d.date,
          route: route.filter((v, i, a) => !!v && (i === 0 || v !== a[i - 1])),
          transport: en
            ? english(transport, `${p}.transportEn`, !!d.transport)
            : d.transport
                .split(',')
                .filter(Boolean)
                .map(
                  (code) =>
                    dictionaries.find(
                      (i) => i.type === 'transport-method' && i.code === code,
                    )?.name ?? code,
                )
                .join(' / '),
          description: en
            ? d.items
                .map((item) =>
                  item.resourceId
                    ? (resourceMap
                        .get(`${item.type}:${item.resourceId}`)
                        ?.englishDescription?.trim() ?? '')
                    : '',
                )
                .filter(Boolean)
                .join('\n')
            : (d.description ?? ''),
          overnightDestination: en
            ? city(
                d.overnightDestination ?? '',
                undefined,
                `cities[${d.overnightDestination}].englishName`,
              )
            : (d.overnightDestination ?? ''),
          meals: d.meals,
          items: d.items.map((i) => {
            const r = i.resourceId
              ? resourceMap.get(`${i.type}:${i.resourceId}`)
              : undefined;
            const path = `${p}.items[${i.id}]`;
            return {
              id: i.id,
              unit: en
                ? english(
                    dictionaries.find(
                      (d) => d.type === 'resource-unit' && d.code === i.unit,
                    )?.englishName,
                    `${path}.unitEnglishName`,
                  )
                : (dictionaries.find(
                    (d) => d.type === 'resource-unit' && d.code === i.unit,
                  )?.name ?? i.unit),
              name: en
                ? english(
                    r?.englishName ?? i.resourceNameEn,
                    `${path}.resourceNameEn`,
                  )
                : i.resourceName,
              description: en
                ? english(
                    r?.englishDescription,
                    `${path}.englishDescription`,
                    !!r?.description?.trim(),
                  )
                : (r?.description ?? ''),
              remark: en
                ? english(i.remarkEn, `${path}.remarkEn`, !!i.remark.trim())
                : i.remark,
            };
          }),
        };
      }),
      hotels: plan.hotelPlans.flatMap((p) =>
        p.hotels.map((h) => ({
          hotelId: h.hotelId,
          name: en
            ? english(
                resourceMap.get(`hotel:${h.hotelId}`)?.englishName,
                `hotels[${h.hotelId}].englishName`,
              )
            : h.hotelName,
          destination: en
            ? city(
                h.destination,
                undefined,
                `cities[${h.destination}].englishName`,
              )
            : h.destination,
        })),
      ),
      notes: (
        [
          'holidayRestrictions',
          'hotelReplacementTerms',
          'customerNotes',
        ] as const
      )
        .filter((k) => plan.quote[k].trim())
        .map((k) =>
          en ? english(plan.quote[`${k}En`], `quote.${k}En`) : plan.quote[k],
        ),
      transportFees: plan.quote.transportFees.map((f) => ({
        id: f.id,
        departureCity: en
          ? city(
              f.departureCity,
              f.departureCityEn,
              `transportFees[${f.id}].departureCityEn`,
            )
          : f.departureCity,
        arrivalCity: en
          ? city(
              f.arrivalCity,
              f.arrivalCityEn,
              `transportFees[${f.id}].arrivalCityEn`,
            )
          : f.arrivalCity,
      })),
      returnArrival:
        plan.customerDisplayMode === 'returnArrival'
          ? {
              dayNumber: plan.dailyPlans.length + 1,
              date: dateAt(plan.startDate, plan.dailyPlans.length),
              text: en
                ? english(plan.returnArrivalTextEn, 'returnArrivalTextEn')
                : (plan.returnArrivalText ?? '返回温馨的家'),
            }
          : null,
    };
  };
  const zh = content('zh'),
    en = content('en');
  return {
    version: 1,
    serviceDays: plan.dailyPlans.length,
    displayDays:
      plan.dailyPlans.length +
      (plan.customerDisplayMode === 'returnArrival' ? 1 : 0),
    accommodationNights: plan.dailyPlans.filter((d) => !!d.overnightDestination)
      .length,
    noAccommodation:
      plan.dailyPlans.length > 0 &&
      plan.dailyPlans.every((d) => d.overnightDestination === ''),
    missingEnglish: [...missing],
    zh,
    en,
  };
}

export function exportSnapshot(
  snapshot: CurrentPdfData,
  language: 'zh' | 'en',
): CurrentPdfData {
  return { ...snapshot, exportLanguage: language };
}
