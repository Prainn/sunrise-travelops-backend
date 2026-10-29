import {
  normalizeVehiclePrice,
  websiteQuotationOptions,
} from './website-price';
import { toCents } from '../inquiries/money';
import { randomUUID } from 'node:crypto';
import { HttpStatus } from '@nestjs/common';
import { BusinessException } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/constants/error-code';
import type {
  FeeState,
  VehicleType,
  WebsiteConfig,
  WebsiteDay,
  WebsiteInquiry,
  WebsiteItinerary,
  WebsiteItineraryInput,
  WebsiteOutput,
  WebsitePreview,
  WebsiteValidation,
} from './website.types';

export const WEBSITE_VEHICLES = {
  '5_seat': { seats: 5, en: '5-seat vehicle', zh: '5座车' },
  '7_seat': { seats: 7, en: '7-seat vehicle', zh: '7座车' },
  '9_seat': { seats: 9, en: '9-seat vehicle', zh: '9座车' },
  '14_seat': { seats: 14, en: '14-seat vehicle', zh: '14座车' },
  '18_seat': { seats: 18, en: '18-seat vehicle', zh: '18座车' },
} as const;

/** Preserve authored custom vehicle names; translate only established vehicle codes. */
export function websiteTransportVehicleLabel(
  value: string,
  language: 'en' | 'zh',
): string {
  return Object.hasOwn(WEBSITE_VEHICLES, value)
    ? WEBSITE_VEHICLES[value as VehicleType][language]
    : value;
}

const TEMPLATE_VARIABLES = new Map<string, readonly string[]>([
  ['arrival-basic', ['city']],
  ['departure-basic', ['city']],
  ['overnight', ['city']],
  ['guide', ['language']],
  ['private-driver', []],
  ['hsr-second-class', ['city']],
  ['hotel-breakfast', ['hotel']],
  ['first-entry-ticket', ['attraction']],
  ['included-service', ['service']],
  ['restaurant-recommendation', ['restaurant_or_meal']],
  ['optional-not-included', ['component']],
  ['hotel-substitution', []],
  ['peak-season', []],
  ['no-shopping', []],
]);

const MONEY = /^(0|[1-9]\d{0,9})(\.\d{1,2})?$/;

function invalid(message: string): never {
  throw new BusinessException({
    code: ErrorCode.VALIDATION_ERROR,
    status: HttpStatus.BAD_REQUEST,
    message,
  });
}

/**
 * Validate authored configuration relationships without inventing missing data.
 */
export function validateWebsiteConfig(config: WebsiteConfig): void {
  const groups = [
    config.cities,
    config.attractions,
    config.hotels,
    config.routes,
    config.patterns,
    config.skeletons,
    config.templates,
  ];
  const ids = new Set<string>();
  for (const group of groups) {
    for (const item of group) {
      if (ids.has(item.id)) invalid('配置记录 ID 不可重复');
      ids.add(item.id);
    }
  }
  const cities = new Map(config.cities.map((city) => [city.id, city]));
  const attractions = new Map(
    config.attractions.map((item) => [item.id, item]),
  );
  const patterns = new Map(config.patterns.map((item) => [item.id, item]));
  const codes = new Set<string>();
  for (const template of config.templates) {
    if (codes.has(template.code)) invalid('标准文案编码不可重复');
    codes.add(template.code);
    const variables = TEMPLATE_VARIABLES.get(template.code) ?? [
      'city',
      'attraction',
    ];
    const tokens = (text: string) =>
      [...new Set([...text.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]))]
        .sort()
        .join(',');
    if (tokens(template.zh) !== tokens(template.en))
      invalid(`文案 ${template.code} 的中英文变量必须一致`);
    const matches = `${template.zh} ${template.en}`.matchAll(/\{([^{}]+)\}/g);
    for (const match of matches) {
      if (!variables.includes(match[1]))
        invalid(`文案 ${template.code} 使用了未支持的变量 ${match[1]}`);
    }
  }
  for (const item of config.attractions) {
    if (!cities.has(item.cityId)) invalid('景点必须关联已有独立站城市');
    if (item.parentId) {
      const parent = attractions.get(item.parentId);
      if (!parent || parent.cityId !== item.cityId)
        invalid('父景点必须存在并属于同一城市');
      const visited = new Set([item.id]);
      let current = parent;
      while (current) {
        if (visited.has(current.id)) invalid('景点父子关系不能成环');
        visited.add(current.id);
        if (!current.parentId) break;
        const ancestor = attractions.get(current.parentId);
        if (!ancestor) invalid('父景点不存在');
        current = ancestor;
      }
    }
    if (new Set(item.recommendedMonths).size !== item.recommendedMonths.length)
      invalid('季节推荐月份不可重复');
  }
  for (const hotel of config.hotels) {
    if (!cities.has(hotel.cityId)) invalid('酒店必须关联已有独立站城市');
    if (typeof hotel.price !== 'string' || !MONEY.test(hotel.price))
      invalid('独立站价格必须为非负金额，最多两位小数');
  }
  for (const route of config.routes) {
    if (route.mode !== 'private_vehicle' && route.vehicleOptions.length > 0)
      invalid('非包车交通段不能填写车型');
    if (route.mode === 'private_vehicle' && route.durationMinutes != null)
      invalid('包车预计耗时必须按车型填写');
    if (!cities.has(route.fromCityId) || !cities.has(route.toCityId))
      invalid('路线的起点和终点必须为已有独立站城市');
  }
  for (const pattern of config.patterns) {
    if (!cities.has(pattern.cityId)) invalid('单日行程模板 城市不存在');
    for (const id of pattern.attractionIds) {
      if (attractions.get(id)?.cityId !== pattern.cityId)
        invalid('单日行程模板 必须引用该城市的景点或组件');
    }
  }
  for (const skeleton of config.skeletons) {
    if (!skeleton.days.length) invalid('城市骨架至少需要一天');
    for (const day of skeleton.days) {
      if (!cities.has(day.cityId)) invalid('城市骨架的城市不存在');
      if (day.patternId && patterns.get(day.patternId)?.cityId !== day.cityId)
        invalid('城市骨架的 单日行程模板 与城市不一致');
    }
  }
}

/**
 * Generate editable days from a specifically selected, enabled configuration.
 */
export function generateWebsiteDraft(
  input: WebsiteItineraryInput,
  config: WebsiteConfig,
  skeletonId: string,
): WebsiteItineraryInput {
  const skeleton = config.skeletons.find(
    (item) => item.id === skeletonId && item.status === 'enabled',
  );
  if (!skeleton) invalid('请选择启用的城市骨架');
  if (skeleton.days.length !== input.duration)
    invalid('城市骨架天数必须与行程天数一致');
  const cities = new Map(config.cities.map((item) => [item.id, item]));
  const days: WebsiteDay[] = [];
  for (const [index, definition] of skeleton.days.entries()) {
    if (cities.get(definition.cityId)?.status !== 'enabled')
      invalid('城市骨架引用的城市已停用');
    const first = index === 0;
    const last = index === skeleton.days.length - 1;
    const pattern = definition.patternId
      ? config.patterns.find(
          (item) =>
            item.id === definition.patternId && item.status === 'enabled',
        )
      : undefined;
    if (definition.patternId && !pattern) invalid('单日行程模板已停用');
    const departCityId = first
      ? definition.cityId
      : skeleton.days[index - 1].cityId;
    const matchingRoutes = config.routes.filter(
      (item) =>
        item.status === 'enabled' &&
        item.fromCityId === departCityId &&
        item.toCityId === definition.cityId,
    );
    const route = matchingRoutes.length === 1 ? matchingRoutes[0] : undefined;
    const items: WebsiteDay['items'] = [];
    if (pattern) {
      for (const attractionId of pattern.attractionIds) {
        const attraction = config.attractions.find(
          (item) => item.id === attractionId && item.status === 'enabled',
        );
        if (!attraction) invalid('单日行程模板引用的景点或组件已停用');
        const copy = config.templates.find(
          (item) =>
            item.code === attraction.copyKey && item.status === 'enabled',
        );
        items.push({
          id: randomUUID(),
          attractionId,
          nameZh: attraction.nameZh,
          nameEn: attraction.nameEn,
          descriptionZh: copy?.zh ?? '',
          descriptionEn: copy?.en ?? '',
          appears: true,
          feeState: attraction.kind === 'component' ? 'EXCLUDED' : 'INCLUDED',
        });
      }
    }
    days.push({
      id: randomUUID(),
      dayNumber: index + 1,
      departCityId,
      endCityId: definition.cityId,
      overnightCityId: last ? null : definition.cityId,
      items,
      legs:
        departCityId === definition.cityId || !route
          ? []
          : [
              {
                id: randomUUID(),
                routeId: route.id,
                vehicleType:
                  route.vehicleOptions.length === 1
                    ? route.vehicleOptions[0].vehicleType
                    : null,
                distanceKm: route.distanceKm ?? null,
                durationMinutes:
                  route.mode === 'private_vehicle'
                    ? route.vehicleOptions.length === 1
                      ? route.vehicleOptions[0].durationMinutes
                      : null
                    : (route.durationMinutes ?? null),
                showInMileage: false,
                fromCityId: route.fromCityId,
                toCityId: route.toCityId,
                mode: route.mode,
                nameZh: route.nameZh,
                nameEn: route.nameEn,
                feeState: route.feeState,
              },
            ],
      hotels: last
        ? []
        : [
            {
              id: randomUUID(),
              tier: 'A',
              cityId: definition.cityId,
              configHotelId: null,
              resourceId: null,
              nameZh: '',
              nameEn: '',
              roomType: '',
              breakfastIncluded: true,
            },
          ],
      meals: ['breakfast', 'lunch', 'dinner'].map((slot) => ({
        id: randomUUID(),
        slot: slot as 'breakfast' | 'lunch' | 'dinner',
        resourceId: null,
        restaurantZh: '',
        restaurantEn: '',
        feeState: slot === 'breakfast' && !first ? 'INCLUDED' : 'SELF_PAY',
      })),
      guideLanguage: '',
      services: [],
    });
  }
  return { ...input, configVersion: config.version, days };
}

/**
 * Produce both language projections from the same saved business facts.
 */
export function buildWebsitePreview(
  inquiry: WebsiteInquiry,
  itinerary: WebsiteItinerary,
  config: WebsiteConfig,
): WebsitePreview {
  const quotationOptions = websiteQuotationOptions(itinerary.days);
  itinerary = {
    ...itinerary,
    vehiclePrices: itinerary.vehiclePrices.map((price) => ({
      ...normalizeVehiclePrice(price),
      includesDriver: quotationOptions.includesDriver,
      includesGuide: quotationOptions.includesGuide,
    })),
  };
  const issues: WebsiteValidation[] = [];
  function issue(
    code: string,
    severity: WebsiteValidation['severity'],
    message: string,
    dayNumber?: number,
  ) {
    if (
      !issues.some(
        (item) =>
          item.code === code &&
          item.dayNumber === dayNumber &&
          item.message === message,
      )
    )
      issues.push({
        code,
        severity,
        message,
        ...(dayNumber ? { dayNumber } : {}),
      });
  }
  if (
    itinerary.days.length !== itinerary.duration ||
    itinerary.days.some((day, index) => day.dayNumber !== index + 1)
  )
    issue('VAL-E01', 'ERROR', '行程日数及顺序必须与计划天数一致');
  if (!itinerary.vehiclePrices.some((price) => price.unitPrice !== null))
    issue('VAL-E07', 'ERROR', '至少填写一个车型与酒店档次组合的人民币人均售价');
  if (itinerary.pax === null)
    issue('VAL-E08', 'ERROR', '正式确认前请填写报价人数');
  if (itinerary.configVersion !== config.version)
    issue('CONFIG_NOT_READY', 'ERROR', '行程引用的配置版本不一致');

  const cities = new Map(config.cities.map((city) => [city.id, city]));
  const attractions = new Map(
    config.attractions.map((item) => [item.id, item]),
  );
  const hotels = new Map(config.hotels.map((item) => [item.id, item]));
  if (!itinerary.title.trim())
    issue('ITINERARY_INVALID', 'ERROR', '请填写行程名称');
  const selectedMileages = itinerary.days.flatMap((day) => {
    const order = [
      ...new Set([...(day.eventOrder ?? []), ...day.legs.map((leg) => leg.id)]),
    ];
    return order.flatMap((id) =>
      day.legs.filter((leg) => leg.id === id && leg.showInMileage),
    );
  });
  const pricedPlans = itinerary.vehiclePrices.filter(
    (price) => price.unitPrice !== null,
  );
  for (const price of itinerary.vehiclePrices) {
    if (
      !quotationOptions.vehicleTypes.includes(price.vehicleType) ||
      !quotationOptions.hotelTiers.includes(price.hotelTier)
    )
      issue(
        'VAL-E09',
        'ERROR',
        '报价组合已不在当前行程中，请调整车型或酒店档次',
      );
    if (price.unitPrice === null) continue;
    for (const day of itinerary.days) {
      if (
        day.overnightCityId &&
        !day.hotels.some(
          (hotel) =>
            hotel.tier === price.hotelTier &&
            hotel.nameZh.trim() &&
            hotel.nameEn.trim(),
        )
      )
        issue(
          'VAL-E09',
          'ERROR',
          '已报价酒店档次须覆盖每个住宿日并填写双语酒店名，不能推测其他档次酒店',
          day.dayNumber,
        );
    }
  }
  const seenAttractions = new Set<string>();
  const visited: string[] = [];
  for (const day of itinerary.days) {
    for (const cityId of [day.departCityId, day.endCityId]) {
      if (!cityId || cities.get(cityId)?.status !== 'enabled')
        issue(
          'CONFIG_NOT_READY',
          'ERROR',
          '请维护并选择独立站城市',
          day.dayNumber,
        );
      if (visited.at(-1) !== cityId) visited.push(cityId);
    }
    if (day.overnightCityId) {
      if (day.overnightCityId !== day.endCityId)
        issue(
          'VAL-E02',
          'ERROR',
          '住宿城市必须与当日结束城市一致',
          day.dayNumber,
        );
      if (
        !day.hotels.some((hotel) => hotel.nameEn.trim() && hotel.nameZh.trim())
      )
        issue(
          'VAL-E06',
          'ERROR',
          '需要住宿的日程必须填写双语酒店名',
          day.dayNumber,
        );
      for (const hotel of day.hotels) {
        if (hotel.configHotelId) {
          const configured = hotels.get(hotel.configHotelId);
          if (!configured || configured.cityId !== hotel.cityId)
            issue(
              'CONFIG_NOT_READY',
              'ERROR',
              '所选独立站酒店不存在或与住宿城市不一致',
              day.dayNumber,
            );
        }
        if (hotel.cityId !== day.overnightCityId)
          issue(
            'VAL-E02',
            'ERROR',
            '酒店城市与当日住宿城市不一致',
            day.dayNumber,
          );
      }
    } else if (day.hotels.length) {
      issue(
        'VAL-E02',
        'ERROR',
        '填写住宿酒店时必须明确住宿城市',
        day.dayNumber,
      );
    }
    const allowedCities = new Set([
      day.departCityId,
      day.endCityId,
      ...day.legs.flatMap((leg) => [leg.fromCityId, leg.toCityId]),
    ]);
    for (const item of day.items) {
      const attraction = attractions.get(item.attractionId ?? '');
      if (attraction && !allowedCities.has(attraction.cityId))
        issue(
          'VAL-E03',
          'ERROR',
          `景点或组件不在当天行程城市：${item.nameZh}`,
          day.dayNumber,
        );
    }
    let legCity = day.departCityId;
    for (const leg of day.legs) {
      if (leg.mode === 'private_vehicle' && !leg.vehicleType)
        issue(
          'ITINERARY_INVALID',
          'ERROR',
          '请明确包车交通段车型（例如5座或7座）',
          day.dayNumber,
        );
      if (leg.mode !== 'private_vehicle' && leg.vehicleType != null)
        issue(
          'ITINERARY_INVALID',
          'ERROR',
          '非包车交通段不能填写车型',
          day.dayNumber,
        );
      if (leg.fromCityId !== legCity)
        issue(
          'VAL-E03',
          'ERROR',
          '交通段必须连续连接当日起终点',
          day.dayNumber,
        );
      legCity = leg.toCityId;
    }
    if (legCity !== day.endCityId)
      issue('VAL-E03', 'ERROR', '跨城移动必须有对应交通段', day.dayNumber);
    if (day.dayNumber > 1) {
      const previous = itinerary.days[day.dayNumber - 2];
      if (previous && previous.endCityId !== day.departCityId)
        issue(
          'VAL-E03',
          'ERROR',
          '相邻日程的城市移动必须在交通段体现',
          day.dayNumber,
        );
    }
    for (const entry of [
      ...day.items,
      ...day.legs,
      ...day.meals,
      ...day.services,
    ]) {
      if (entry.feeState === 'UNKNOWN')
        issue(
          'VAL-E04',
          'ERROR',
          '正式输出前必须确认服务费用状态',
          day.dayNumber,
        );
    }
    for (const item of day.items) {
      if (!item.appears) continue;
      const identity = item.attractionId ?? item.nameEn.trim().toLowerCase();
      if (seenAttractions.has(identity))
        issue(
          'VAL-W01',
          'WARNING',
          `行程中重复安排 ${item.nameZh}`,
          day.dayNumber,
        );
      seenAttractions.add(identity);
      const attraction = item.attractionId
        ? attractions.get(item.attractionId)
        : undefined;
      if (item.attractionId && attraction?.status !== 'enabled')
        issue(
          'CONFIG_NOT_READY',
          'ERROR',
          '景点配置不存在或未启用',
          day.dayNumber,
        );
      if (
        attraction &&
        !config.templates.some(
          (copy) =>
            copy.code === attraction.copyKey &&
            copy.status === 'enabled' &&
            copy.en.trim() &&
            copy.zh.trim(),
        )
      )
        issue(
          'CONFIG_NOT_READY',
          'ERROR',
          `请维护并启用 ${item.nameZh} 的标准双语文案`,
          day.dayNumber,
        );
      if (!item.descriptionEn.trim() || !item.descriptionZh.trim())
        issue(
          'CONFIG_NOT_READY',
          'ERROR',
          `请补齐 ${item.nameZh} 的双语文案`,
          day.dayNumber,
        );
      if (
        attraction &&
        itinerary.startDate &&
        attraction.recommendedMonths.length
      ) {
        const actualMonth =
          new Date(
            Date.parse(`${itinerary.startDate}T00:00:00Z`) +
              (day.dayNumber - 1) * 86_400_000,
          ).getUTCMonth() + 1;
        if (!attraction.recommendedMonths.includes(actualMonth))
          issue(
            'VAL-W02',
            'WARNING',
            `${item.nameZh} 不在配置推荐月份内`,
            day.dayNumber,
          );
      }
    }
  }
  let destinationPosition = -1;
  for (const cityId of inquiry.destinations) {
    const position = visited.indexOf(cityId, destinationPosition + 1);
    if (position === -1) {
      issue(
        'REQUIREMENTS_MISMATCH',
        'ERROR',
        '行程须遵循询盘中明确的目的地及顺序',
      );
      break;
    }
    destinationPosition = position;
  }
  if (inquiry.startDate && inquiry.startDate !== itinerary.startDate)
    issue(
      'REQUIREMENTS_MISMATCH',
      'ERROR',
      '行程开始日期与询盘已确认日期不一致',
    );

  function output(language: 'en' | 'zh'): WebsiteOutput {
    const inclusions = new Set<string>();
    const exclusions = new Set<string>();
    const categories = [
      'hotel',
      'meal',
      'entry',
      'service',
      'transport',
    ] as const;
    type Category = (typeof categories)[number];
    const standards = new Map<Category, Set<string>>(
      categories.map((category) => [category, new Set()]),
    );
    function include(line: string, category: Category) {
      if (!line) return;
      inclusions.add(line);
      standards.get(category)!.add(line);
    }
    const hotelLabels = {
      A: { en: '5-star', zh: '五星' },
      B: { en: '4-star', zh: '四星' },
      C: { en: '3-star', zh: '三星' },
      D: { en: '2-star and below', zh: '二星及以下' },
    };
    const hotelLabel = (tier: keyof typeof hotelLabels | null) =>
      tier
        ? hotelLabels[tier][language]
        : language === 'en'
          ? 'No accommodation'
          : '不住宿';
    const vehicleLabel = (vehicle: string | null) =>
      vehicle
        ? websiteTransportVehicleLabel(vehicle, language)
        : language === 'en'
          ? 'No private vehicle'
          : '无专车';

    function city(id: string): string {
      const record = cities.get(id);
      return record ? (language === 'en' ? record.nameEn : record.nameZh) : '';
    }
    function template(
      code: string,
      values: Record<string, string> = {},
    ): string {
      const record = config.templates.find(
        (item) => item.code === code && item.status === 'enabled',
      );
      if (!record || !record.en.trim() || !record.zh.trim()) {
        issue('CONFIG_NOT_READY', 'ERROR', `请维护并启用双语文案 ${code}`);
        return '';
      }
      return interpolate(record[language], values, code);
    }
    function interpolate(
      content: string,
      values: Record<string, string>,
      code: string,
    ): string {
      return content.replace(/\{([^{}]+)\}/g, (_, key: string) => {
        if (!(key in values)) {
          issue(
            'CONFIG_NOT_READY',
            'ERROR',
            `文案 ${code} 的变量 ${key} 缺少值`,
          );
          return '';
        }
        return values[key];
      });
    }
    function includeService(
      name: string,
      state: FeeState,
      category: Category = 'service',
    ) {
      if (state === 'INCLUDED')
        include(template('included-service', { service: name }), category);
    }
    const hotelOptions: WebsiteOutput['hotelOptions'] = [];
    const hotelStays = new Map<string, WebsiteOutput['hotelOptions'][number]>();
    const itineraryRows: WebsiteOutput['itinerary'] = [];
    for (const day of itinerary.days) {
      const attractionsById = new Map<string, string>();
      for (const item of day.items) {
        const name = language === 'en' ? item.nameEn : item.nameZh;
        if (item.appears) {
          const attraction = item.attractionId
            ? attractions.get(item.attractionId)
            : undefined;
          attractionsById.set(
            item.id,
            attraction
              ? interpolate(
                  language === 'en' ? item.descriptionEn : item.descriptionZh,
                  { city: city(attraction.cityId), attraction: name },
                  attraction.copyKey,
                )
              : language === 'en'
                ? item.descriptionEn
                : item.descriptionZh,
          );
        }
        if (item.feeState === 'INCLUDED') {
          const attraction = item.attractionId
            ? attractions.get(item.attractionId)
            : undefined;
          if (attraction?.chargeable && attraction.kind === 'attraction') {
            const line = template('first-entry-ticket', { attraction: name });
            include(line, 'entry');
          } else {
            includeService(name, item.feeState, 'entry');
          }
        }
      }
      if (day.guideLanguage.trim()) {
        const line =
          language === 'en'
            ? `D${day.dayNumber}: Tour guide (${day.guideLanguage.trim()}) included.`
            : `第${day.dayNumber}天：包含${day.guideLanguage.trim()}导游服务。`;
        include(line, 'service');
      }
      for (const service of day.services) {
        includeService(
          language === 'en' ? service.nameEn : service.nameZh,
          service.feeState,
        );
      }
      const orderedLegs = [...day.legs].sort((a, b) => {
        const order = day.eventOrder ?? [];
        const position = (id: string) => {
          const index = order.indexOf(id);
          return index < 0 ? order.length : index;
        };
        return position(a.id) - position(b.id);
      });
      const transportation = orderedLegs.map((leg) => {
        includeService(
          language === 'en' ? leg.nameEn : leg.nameZh,
          leg.feeState,
          'transport',
        );
        if (leg.feeState === 'INCLUDED' && leg.mode === 'hsr') {
          include(
            template('hsr-second-class', { city: city(leg.toCityId) }),
            'transport',
          );
        }
        return {
          hsr: language === 'en' ? 'High-speed train' : '高铁',
          private_vehicle: language === 'en' ? 'Private vehicle' : '包车',
          flight: language === 'en' ? 'Flight' : '航班',
          other: language === 'en' ? 'Other' : '其他',
        }[leg.mode];
      });
      for (const hotel of day.overnightCityId ? day.hotels : []) {
        const name = language === 'en' ? hotel.nameEn : hotel.nameZh;
        const hotelOption = {
          tier: hotel.tier,
          city: city(hotel.cityId),
          hotel: name,
          roomType: hotel.roomType,
          tierLabel: hotelLabel(hotel.tier),
          startDay: day.dayNumber,
          endDay: day.dayNumber,
          nights: 1,
          breakfastIncluded: hotel.breakfastIncluded,
        };
        if (day.overnightCityId) {
          const stayKey = JSON.stringify([
            hotel.tier,
            hotel.cityId,
            hotel.configHotelId,
            hotel.resourceId,
            name,
            hotel.roomType,
            hotel.breakfastIncluded,
          ]);
          const previous = hotelStays.get(stayKey);
          if (previous?.endDay === day.dayNumber - 1) {
            previous.endDay = day.dayNumber;
            previous.nights = (previous.nights ?? 1) + 1;
          } else {
            hotelOptions.push(hotelOption);
            hotelStays.set(stayKey, hotelOption);
          }
        }
        if (hotel.breakfastIncluded) {
          const hotelLine = template('hotel-breakfast', { hotel: name });
          include(hotelLine, 'hotel');
        } else includeService(name, 'INCLUDED', 'hotel');
      }
      const mealLabels =
        language === 'en'
          ? { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' }
          : { breakfast: '早餐', lunch: '午餐', dinner: '晚餐' };
      for (const meal of day.meals) {
        const restaurant =
          language === 'en' ? meal.restaurantEn : meal.restaurantZh;
        const label = mealLabels[meal.slot];
        includeService(
          restaurant ? `${label}: ${restaurant}` : label,
          meal.feeState,
          'meal',
        );
      }
      const includedMeals = new Set(
        day.meals
          .filter((meal) => meal.feeState === 'INCLUDED')
          .map((meal) => meal.slot),
      );
      if (
        day.overnightCityId &&
        day.hotels.some((hotel) => hotel.breakfastIncluded)
      )
        includedMeals.add('breakfast');
      const meals = (['breakfast', 'lunch', 'dinner'] as const)
        .filter((slot) => includedMeals.has(slot))
        .map((slot) =>
          language === 'en'
            ? { breakfast: 'B', lunch: 'L', dinner: 'D' }[slot]
            : mealLabels[slot],
        );
      const date = itinerary.startDate
        ? new Date(
            Date.parse(`${itinerary.startDate}T00:00:00Z`) +
              (day.dayNumber - 1) * 86_400_000,
          )
            .toISOString()
            .substring(0, 10)
        : `D${day.dayNumber}`;
      const orderedDescriptions = (day.eventOrder ?? []).flatMap((id) => {
        const description = attractionsById.get(id);
        attractionsById.delete(id);
        return description ? [description] : [];
      });
      itineraryRows.push({
        day: date,
        depart: city(day.departCityId),
        transportation: [...new Set(transportation)].join('\n'),
        sightseeing: [...orderedDescriptions, ...attractionsById.values()]
          .filter(Boolean)
          .join('\n'),
        hotel: day.overnightCityId ? city(day.overnightCityId) : '',
        meal: meals.join(' / '),
      });
    }
    if (quotationOptions.includesDriver) {
      const days = quotationOptions.driverDays
        .map((day) => `D${day}`)
        .join(', ');
      include(
        language === 'en'
          ? `Private driver included on ${days}. The driver provides transportation and ticketing assistance only; guiding and commentary inside scenic areas are not included in the driver's service.`
          : `第${quotationOptions.driverDays.join('、')}天包含专车司机。司机仅提供交通与票务协助，不提供景区内导览或讲解服务。`,
        'service',
      );
      include(
        language === 'en'
          ? `Vehicle options: ${quotationOptions.vehicleTypes
              .filter((vehicle): vehicle is string => vehicle !== null)
              .map((vehicle) => vehicleLabel(vehicle))
              .join(' / ')}; see the selected quotation option.`
          : `报价车型：${quotationOptions.vehicleTypes
              .filter((vehicle): vehicle is string => vehicle !== null)
              .map((vehicle) => vehicleLabel(vehicle))
              .join(' / ')}，以选定报价组合为准。`,
        'transport',
      );
    }
    exclusions.add(
      language === 'en'
        ? 'The following default exclusions do not apply to items explicitly listed as included in this quotation.'
        : '以下默认不含项目中，已明确列入本报价包含项的项目除外。',
    );
    exclusions.add(
      language === 'en'
        ? 'International and domestic flights, travel insurance and personal expenses.'
        : '国际及国内机票、旅游保险和个人消费。',
    );
    exclusions.add(
      language === 'en'
        ? 'Lunch and dinner, unless explicitly included in this quotation.'
        : '午餐和晚餐（本报价明确包含的餐食除外）。',
    );
    const optional = template('optional-not-included', {
      component:
        language === 'en' ? 'Optional scenic-area activities' : '景区可选活动',
    });
    if (optional) exclusions.add(optional);
    return {
      title: itinerary.title,
      itinerary: itineraryRows,
      inclusions: [...inclusions],
      exclusions: [...exclusions],
      hotelOptions,
      quotationServices: quotationOptions,
      quotation: [...pricedPlans]
        .sort(
          (a, b) =>
            (a.hotelTier ?? '').localeCompare(b.hotelTier ?? '') ||
            (a.vehicleType ?? '').localeCompare(b.vehicleType ?? '', 'en', {
              numeric: true,
            }),
        )
        .map((price) => {
          const cents = BigInt(toCents(Number(price.unitPrice)));
          const money = (value: bigint) =>
            `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
          const unitPrice = money(cents);
          const services =
            [
              price.includesDriver
                ? language === 'en'
                  ? 'Private driver'
                  : '司机'
                : '',
              price.includesGuide
                ? language === 'en'
                  ? 'Tour guide'
                  : '导游'
                : '',
            ]
              .filter(Boolean)
              .join(' + ') ||
            (language === 'en'
              ? 'No driver or tour guide included'
              : '不含司机及导游');
          return {
            vehicle: vehicleLabel(price.vehicleType),
            vehicleType: price.vehicleType,
            hotelTier: price.hotelTier,
            hotelCategory: hotelLabel(price.hotelTier),
            includesDriver: price.includesDriver,
            includesGuide: price.includesGuide,
            pax: itinerary.pax,
            unitPrice,
            priceComponents: (price.priceComponents ?? [])
              .filter(
                (component) =>
                  component.showInPdf && component.unitPrice !== null,
              )
              .map((component) => ({
                category: component.category,
                unitPrice: money(BigInt(toCents(Number(component.unitPrice)))),
              })),
            totalPrice:
              itinerary.pax === null
                ? null
                : money(cents * BigInt(itinerary.pax)),
            services,
            price: `RMB ${unitPrice} PP`,
          };
        }),
      teamStandard: categories.map((category) => ({
        category,
        included: [...standards.get(category)!],
      })),
      mileage: selectedMileages.flatMap((row) =>
        row
          ? [
              {
                route: `${city(row.fromCityId)} / ${city(row.toCityId)}`,
                distanceKm: row.distanceKm ?? null,
                durationMinutes: row.durationMinutes ?? null,
                vehicleType: row.vehicleType ?? null,
                transport: {
                  hsr: language === 'en' ? 'High-speed train' : '高铁',
                  private_vehicle: row.vehicleType
                    ? websiteTransportVehicleLabel(row.vehicleType, language)
                    : language === 'en'
                      ? 'Private vehicle'
                      : '包车',
                  flight: language === 'en' ? 'Flight' : '航班',
                  other: language === 'en' ? 'Other' : '其他',
                }[row.mode],
              },
            ]
          : [],
      ),
      notes: [template('peak-season'), template('hotel-substitution')].filter(
        Boolean,
      ),
      noShopping: template('no-shopping'),
    };
  }
  const english = output('en');
  const chinese = output('zh');
  return {
    itineraryId: itinerary.id,
    sourceVersion: itinerary.version,
    inquiryVersion: inquiry.version,
    configVersion: config.version,
    schemaVersion: 6,
    validationVersion: 5,
    issues,
    english,
    chinese,
  };
}
