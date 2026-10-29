import type { EntityManager } from 'typeorm';
import type { CurrentPdfData } from '../inquiries/inquiry.entity';
import type { WebsiteConfig, WebsiteDay } from '../website/website.types';
import { addDays } from './tour-rules';
import type {
  MapBusinessUnit,
  MapCity,
  MapDay,
  MapIssue,
  MapRole,
  MapStop,
  MapTour,
  TourMapResponse,
} from './tour-map.dto';

export type MapTourRow = Pick<
  MapTour,
  | 'id'
  | 'tourNo'
  | 'businessUnit'
  | 'sourceModule'
  | 'totalPeople'
  | 'adults'
  | 'children'
  | 'leaders'
  | 'guideServices'
  | 'todayGuideServices'
  | 'collectCoordinatorName'
  | 'operatorName'
  | 'pickupAt'
  | 'dropAt'
  | 'pickupFlight'
  | 'dropFlight'
  | 'days'
>;
export type CityLocation = Omit<
  MapCity,
  'tourIds' | 'tourCount' | 'peopleCount'
>;
export interface MapPlan {
  tourId: string;
  standard?: CurrentPdfData['itinerary'];
  startDate?: string;
  days?: WebsiteDay[];
  config?: Pick<WebsiteConfig, 'cities' | 'attractions'>;
  currentConfig?: Pick<WebsiteConfig, 'cities'>;
}
const inYunnan = (province: string) =>
  ['云南', '云南省'].includes(province.trim());

/** Reads only sources of tours already authorized by ToursService. Binding joins prevent cross-source leakage. */
export async function loadMapPlans(
  manager: EntityManager,
  tourIds: string[],
): Promise<MapPlan[]> {
  if (!tourIds.length) return [];
  const standard = await manager.query<MapPlan[]>(
    `SELECT t.id AS "tourId", q.snapshot->'itinerary' AS standard
     FROM tours t JOIN itinerary_quotes q ON q.id=t.quote_id AND q.itinerary_id=t.itinerary_id AND q.inquiry_id=t.inquiry_id
     JOIN inquiries i ON i.id=t.inquiry_id AND i.business_unit=t.business_unit
     WHERE t.id=ANY($1::uuid[]) AND t.source_module='standard'`,
    [tourIds],
  );
  const website = await manager.query<MapPlan[]>(
    `SELECT t.id AS "tourId", it.start_date::text AS "startDate",
      jsonb_build_object('cities',v.config->'cities','attractions',v.config->'attractions') AS config,
      jsonb_build_object('cities',cv.config->'cities') AS "currentConfig",
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id',d.id,'dayNumber',d.day_number,'departCityId',d.depart_city_id,'endCityId',d.end_city_id,
        'overnightCityId',d.overnight_city_id,'eventOrder',d.event_order,
        'items',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',x.id,'attractionId',x.attraction_id,'nameZh',x.name_zh,'appears',x.appears) ORDER BY x.position) FROM website_items x WHERE x.day_id=d.id),'[]'),
        'legs',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',x.id,'fromCityId',x.from_city_id,'toCityId',x.to_city_id,'nameZh',x.name_zh,'mode',x.mode) ORDER BY x.position) FROM website_legs x WHERE x.day_id=d.id),'[]'),
        'hotels',COALESCE((SELECT jsonb_agg(jsonb_build_object('cityId',x.city_id,'nameZh',x.name_zh,'tier',x.tier) ORDER BY x.position) FROM website_hotels x WHERE x.day_id=d.id),'[]'),
        'meals',COALESCE((SELECT jsonb_agg(jsonb_build_object('slot',x.slot,'restaurantZh',x.restaurant_zh,'feeState',x.fee_state) ORDER BY x.position) FROM website_meals x WHERE x.day_id=d.id),'[]')
      ) ORDER BY d.day_number) FROM website_days d WHERE d.itinerary_id=it.id AND NOT d.is_deleted),'[]') AS days
     FROM tours t JOIN website_itineraries it ON it.id=t.itinerary_id AND it.inquiry_id=t.inquiry_id
     JOIN website_inquiries i ON i.id=it.inquiry_id AND i.business_unit=t.business_unit
     JOIN website_quotations q ON q.id=t.quote_id AND q.itinerary_id=it.id
     JOIN website_config_versions v ON v.version=it.config_version AND v.business_unit=t.business_unit
     LEFT JOIN website_config_current c ON c.business_unit=t.business_unit
     LEFT JOIN website_config_versions cv ON cv.version=c.version AND cv.business_unit=t.business_unit
     WHERE t.id=ANY($1::uuid[]) AND t.source_module='website' AND it.status='quoted'
       AND (q.snapshot->>'configVersion')::int=it.config_version`,
    [tourIds],
  );
  return [...standard, ...website];
}

export function buildTourMap(
  date: string,
  unit: MapBusinessUnit | null,
  canSelect: boolean,
  rows: MapTourRow[],
  cities: CityLocation[],
  plans: MapPlan[],
): TourMapResponse {
  const byId = new Map(cities.map((c) => [c.id, c]));
  const byName = new Map(cities.map((c) => [c.name, c]));
  const planByTour = new Map(plans.map((p) => [p.tourId, p]));
  function stop(
    city: CityLocation | undefined,
    name: string,
    role: MapRole,
    missing: MapIssue,
  ): MapStop {
    const issue = !city
      ? missing
      : !inYunnan(city.province)
        ? 'outside_yunnan'
        : city.longitude == null || city.latitude == null
          ? 'coordinates_missing'
          : null;
    return {
      cityId: city?.id ?? null,
      name,
      role,
      longitude: city?.longitude ?? null,
      latitude: city?.latitude ?? null,
      issue,
    };
  }
  function standardDays(plan: NonNullable<MapPlan['standard']>): MapDay[] {
    return plan.dailyPlans
      .map<MapDay>((d) => {
        const named = (name: string, role: MapRole) =>
          stop(byName.get(name.trim()), name, role, 'city_unmatched');
        return {
          date: d.date,
          dayNumber: d.dayNumber,
          stops: [
            named(d.departure, 'departure'),
            named(d.destination, 'arrival'),
            ...(d.overnightDestination
              ? [named(d.overnightDestination, 'overnight')]
              : []),
          ],
          overnightStatus:
            d.overnightDestination == null
              ? 'unconfirmed'
              : d.overnightDestination === ''
                ? 'none'
                : 'planned',
          description: d.description ?? '',
          attractions: d.items
            .filter((i) => i.type === 'attraction')
            .map((i) => i.resourceName),
          meals: Object.entries(d.meals)
            .filter(([, included]) => included)
            .map(([slot]) => slot),
          transport: d.transport ? [d.transport] : [],
          hotelPlans: plan.hotelPlans.flatMap((p) =>
            p.hotels
              .filter((h) => h.destination === d.overnightDestination)
              .map((h) => `${p.tier}: ${h.hotelName}`),
          ),
        };
      })
      .sort((a, b) => a.dayNumber - b.dayNumber);
  }
  function websiteDays(plan: MapPlan): MapDay[] {
    if (!plan.startDate || !plan.config) return [];
    const old = new Map(plan.config.cities.map((c) => [c.id, c]));
    const current = new Map(
      (plan.currentConfig?.cities ?? []).map((c) => [c.id, c]),
    );
    const attractions = new Map(plan.config.attractions.map((a) => [a.id, a]));
    const located = (id: string, role: MapRole) => {
      const historical = old.get(id);
      const latest = current.get(id);
      const resourceId =
        historical?.resourceId ??
        (historical && latest?.nameZh === historical.nameZh
          ? latest.resourceId
          : null);
      return stop(
        resourceId ? byId.get(resourceId) : undefined,
        historical?.nameZh ?? '',
        role,
        'city_unlinked',
      );
    };
    return (plan.days ?? []).map<MapDay>((d) => {
      const events: { id: string; stops: MapStop[] }[] = [
        ...d.items
          .filter((i) => i.appears)
          .map((i) => ({
            id: i.id,
            stops: i.attractionId
              ? [
                  located(
                    attractions.get(i.attractionId)?.cityId ?? '',
                    'visit',
                  ),
                ]
              : [],
          })),
        ...d.legs.map((l) => ({
          id: l.id,
          stops: [
            located(l.fromCityId, 'departure'),
            located(l.toCityId, 'arrival'),
          ],
        })),
      ];
      const order = d.eventOrder ?? [];
      events.sort((a, b) => {
        const ai = order.indexOf(a.id),
          bi = order.indexOf(b.id);
        return (ai < 0 ? order.length : ai) - (bi < 0 ? order.length : bi);
      });
      return {
        date: addDays(plan.startDate!, d.dayNumber - 1),
        dayNumber: d.dayNumber,
        stops: [
          located(d.departCityId, 'departure'),
          ...events.flatMap((e) => e.stops),
          located(d.endCityId, 'arrival'),
          ...(d.overnightCityId
            ? [located(d.overnightCityId, 'overnight')]
            : []),
        ],
        overnightStatus:
          d.overnightCityId == null
            ? 'unconfirmed'
            : d.overnightCityId === ''
              ? 'none'
              : 'planned',
        description: '',
        attractions: d.items.filter((i) => i.appears).map((i) => i.nameZh),
        meals: d.meals.map(
          (m) => `${m.slot}: ${m.restaurantZh} (${m.feeState})`,
        ),
        transport: d.legs.map((l) => l.nameZh || l.mode),
        hotelPlans: d.hotels.map((h) => `${h.tier}: ${h.nameZh}`),
      };
    });
  }
  const tours: MapTour[] = rows.map((row) => {
    const plan = planByTour.get(row.id);
    const route = plan?.standard
      ? standardDays(plan.standard)
      : plan
        ? websiteDays(plan)
        : [];
    const today = route.find((d) => d.date === date) ?? null;
    const issues: MapIssue[] =
      row.sourceModule === 'manual'
        ? ['manual_tour']
        : !plan
          ? ['source_missing']
          : !today
            ? ['date_not_covered']
            : today.stops.flatMap((s) => (s.issue ? [s.issue] : []));
    const located = today?.stops.some((s) => s.issue === null) ?? false;
    if (!located && !issues.length) issues.push('no_location');
    return {
      ...row,
      dayNumber: today?.dayNumber ?? null,
      located,
      issues: [...new Set(issues)],
      today,
      nextDay: route.find((d) => d.date === addDays(date, 1)) ?? null,
      route,
    };
  });
  const mapCities = cities
    .filter((c) => inYunnan(c.province))
    .map((c) => {
      const present = tours.filter((t) =>
        t.today?.stops.some((s) => s.cityId === c.id && !s.issue),
      );
      return {
        ...c,
        tourIds: present.map((t) => t.id),
        tourCount: present.length,
        peopleCount: present.reduce((n, t) => n + t.totalPeople, 0),
      };
    });
  const unlocatedTourIds = tours.filter((t) => !t.located).map((t) => t.id);
  return {
    date,
    timezone: 'Asia/Shanghai',
    coordinateSystem: 'WGS84',
    businessUnit: unit,
    canSelectBusinessUnit: canSelect,
    totals: {
      tours: tours.length,
      people: tours.reduce((n, t) => n + t.totalPeople, 0),
      located: tours.length - unlocatedTourIds.length,
      unlocated: unlocatedTourIds.length,
    },
    cities: mapCities,
    tours,
    unlocatedTourIds,
    pickupTourIds: tours
      .filter((t) => t.pickupAt.slice(0, 10) === date)
      .map((t) => t.id),
    dropTourIds: tours
      .filter((t) => t.dropAt.slice(0, 10) === date)
      .map((t) => t.id),
  };
}
