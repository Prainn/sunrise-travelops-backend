import { randomUUID } from 'node:crypto';
import { HttpStatus } from '@nestjs/common';
import { BusinessException } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/constants/error-code';
import type {
  FeeState,
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
    const variables = `${template.zh} ${template.en}`.matchAll(/\{([^{}]+)\}/g);
    for (const match of variables) {
      if (
        ![
          'city',
          'attraction',
          'language',
          'service_scope',
          'hotel',
          'service',
          'restaurant_or_meal',
          'component',
        ].includes(match[1])
      )
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
  for (const route of config.routes) {
    if (!cities.has(route.fromCityId) || !cities.has(route.toCityId))
      invalid('路线的起点和终点必须为已有独立站城市');
    if (route.fromCityId === route.toCityId)
      invalid('跨城路线的起点与终点必须不同');
  }
  for (const pattern of config.patterns) {
    if (!cities.has(pattern.cityId)) invalid('Day Pattern 城市不存在');
    for (const id of pattern.attractionIds) {
      if (attractions.get(id)?.cityId !== pattern.cityId)
        invalid('Day Pattern 必须引用该城市的景点或组件');
    }
  }
  for (const skeleton of config.skeletons) {
    if (!skeleton.days.length) invalid('城市骨架至少需要一天');
    for (const day of skeleton.days) {
      if (!cities.has(day.cityId)) invalid('城市骨架的城市不存在');
      if (day.patternId && patterns.get(day.patternId)?.cityId !== day.cityId)
        invalid('城市骨架的 Day Pattern 与城市不一致');
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
    const transferOnly =
      (first && !input.arrivalTime.trim()) ||
      (last && !input.departureTime.trim());
    const pattern = definition.patternId
      ? config.patterns.find(
          (item) =>
            item.id === definition.patternId && item.status === 'enabled',
        )
      : undefined;
    if (definition.patternId && !pattern) invalid('Day Pattern 已停用');
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
    if (!transferOnly && pattern) {
      for (const attractionId of pattern.attractionIds) {
        const attraction = config.attractions.find(
          (item) => item.id === attractionId && item.status === 'enabled',
        );
        if (!attraction) invalid('Day Pattern 引用的景点或组件已停用');
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
      guideScope: '',
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
    issue('VAL-E07', 'ERROR', '至少填写一个车型的人民币人均售价');
  if (itinerary.configVersion !== config.version)
    issue('CONFIG_NOT_READY', 'ERROR', '行程引用的配置版本不一致');

  const cities = new Map(config.cities.map((city) => [city.id, city]));
  const attractions = new Map(
    config.attractions.map((item) => [item.id, item]),
  );
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
    let legCity = day.departCityId;
    for (const leg of day.legs) {
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
    if (
      day.items.some((item) => item.appears) &&
      ((day.dayNumber === 1 && !itinerary.arrivalTime.trim()) ||
        (day.dayNumber === itinerary.duration &&
          !itinerary.departureTime.trim()))
    )
      issue(
        'VAL-W03',
        'WARNING',
        '未确认抵达或离开时间时安排了景点',
        day.dayNumber,
      );
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
  if (
    (inquiry.arrivalTime && inquiry.arrivalTime !== itinerary.arrivalTime) ||
    (inquiry.departureTime && inquiry.departureTime !== itinerary.departureTime)
  )
    issue(
      'REQUIREMENTS_MISMATCH',
      'ERROR',
      '行程交通时间与询盘已确认信息不一致',
    );

  function output(language: 'en' | 'zh'): WebsiteOutput {
    const inclusions = new Set<string>();
    const exclusions = new Set<string>();
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
    function serviceLine(name: string, state: FeeState): string {
      if (state === 'INCLUDED') {
        const line = template('included-service', { service: name });
        if (line) inclusions.add(line);
        return line;
      }
      if (state === 'UNKNOWN') return '';
      const labels: Record<
        Exclude<FeeState, 'INCLUDED' | 'UNKNOWN'>,
        string
      > = language === 'en'
        ? {
            EXCLUDED: 'not included',
            OPTIONAL: 'optional, not included',
            RECOMMENDED: 'recommended, not included',
            ARRANGED: 'arranged, fees not included',
            SELF_PAY: 'self-pay',
          }
        : {
            EXCLUDED: '不含费用',
            OPTIONAL: '可选，不含费用',
            RECOMMENDED: '推荐，不含费用',
            ARRANGED: '已安排，不含费用',
            SELF_PAY: '费用自理',
          };
      return `${name} (${labels[state]})`;
    }
    const hotelOptions: WebsiteOutput['hotelOptions'] = [];
    const itineraryRows: WebsiteOutput['itinerary'] = [];
    for (const day of itinerary.days) {
      const sightseeing: string[] = [];
      if (day.dayNumber === 1)
        sightseeing.push(
          template('arrival-basic', { city: city(day.endCityId) }),
        );
      for (const item of day.items) {
        const name = language === 'en' ? item.nameEn : item.nameZh;
        if (item.appears) {
          const attraction = item.attractionId
            ? attractions.get(item.attractionId)
            : undefined;
          sightseeing.push(
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
          if (item.feeState !== 'INCLUDED')
            sightseeing.push(serviceLine(name, item.feeState));
        }
        if (item.feeState === 'INCLUDED') {
          const attraction = item.attractionId
            ? attractions.get(item.attractionId)
            : undefined;
          if (attraction?.chargeable && attraction.kind === 'attraction') {
            const line = template('first-entry-ticket', { attraction: name });
            if (line) inclusions.add(line);
          } else {
            serviceLine(name, item.feeState);
          }
        }
      }
      if (day.guideLanguage.trim()) {
        const line = template('guide', {
          language: day.guideLanguage,
          service_scope: day.guideScope,
        });
        if (!line)
          issue(
            'VAL-E05',
            'ERROR',
            '已选导游必须有双语 Included 文案',
            day.dayNumber,
          );
        else {
          inclusions.add(line);
          sightseeing.push(line);
        }
      }
      for (const service of day.services) {
        const line = serviceLine(
          language === 'en' ? service.nameEn : service.nameZh,
          service.feeState,
        );
        if (service.appears) sightseeing.push(line);
      }
      if (day.overnightCityId)
        sightseeing.push(
          template('overnight', { city: city(day.overnightCityId) }),
        );
      if (day.dayNumber === itinerary.duration)
        sightseeing.push(
          template('departure-basic', { city: city(day.endCityId) }),
        );
      const transportation = day.legs.map((leg) => {
        const name = language === 'en' ? leg.nameEn : leg.nameZh;
        let line = serviceLine(name, leg.feeState);
        if (leg.feeState === 'INCLUDED' && leg.mode === 'hsr') {
          const included = template('hsr-second-class');
          if (included) inclusions.add(included);
        }
        if (leg.mode === 'private_vehicle' && leg.feeState === 'INCLUDED') {
          const included = template('private-driver');
          if (included) inclusions.add(included);
        }
        if (leg.feeState === 'INCLUDED') line = name;
        return `${city(leg.fromCityId)} → ${city(leg.toCityId)}: ${line}`;
      });
      const hotels: string[] = [];
      for (const hotel of day.hotels) {
        const name = language === 'en' ? hotel.nameEn : hotel.nameZh;
        hotels.push(`${hotel.tier}: ${name}`);
        const hotelOption = {
          tier: hotel.tier,
          city: city(hotel.cityId),
          hotel: name,
          roomType: hotel.roomType,
        };
        if (
          !hotelOptions.some(
            (option) =>
              option.tier === hotelOption.tier &&
              option.city === hotelOption.city &&
              option.hotel === hotelOption.hotel &&
              option.roomType === hotelOption.roomType,
          )
        )
          hotelOptions.push(hotelOption);
        if (hotel.breakfastIncluded) {
          const hotelLine = template('hotel-breakfast', { hotel: name });
          if (hotelLine) inclusions.add(hotelLine);
        } else serviceLine(name, 'INCLUDED');
      }
      const mealLabels =
        language === 'en'
          ? { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' }
          : { breakfast: '早餐', lunch: '午餐', dinner: '晚餐' };
      const meals = day.meals.map((meal) => {
        const restaurant =
          language === 'en' ? meal.restaurantEn : meal.restaurantZh;
        const label = mealLabels[meal.slot];
        if (restaurant) {
          const recommendation = template('restaurant-recommendation', {
            restaurant_or_meal: restaurant,
          });
          if (recommendation) sightseeing.push(recommendation);
        }
        return serviceLine(
          restaurant ? `${label}: ${restaurant}` : label,
          meal.feeState,
        );
      });
      const date = itinerary.startDate
        ? new Date(
            Date.parse(`${itinerary.startDate}T00:00:00Z`) +
              (day.dayNumber - 1) * 86_400_000,
          )
            .toISOString()
            .substring(0, 10)
        : `D${day.dayNumber}`;
      itineraryRows.push({
        day: date,
        depart: city(day.departCityId),
        transportation: transportation.filter(Boolean).join('\n'),
        sightseeing: sightseeing.filter(Boolean).join('\n'),
        hotel: hotels.join('\n'),
        meal: meals.filter(Boolean).join('\n'),
      });
    }
    if (itinerary.vehiclePrices.some((price) => price.unitPrice !== null)) {
      const included = template('private-driver');
      if (included) inclusions.add(included);
    }
    exclusions.add(
      language === 'en'
        ? 'International and domestic flights, travel insurance and personal expenses.'
        : '国际及国内机票、旅游保险和个人消费。',
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
      quotation: itinerary.vehiclePrices
        .filter((price) => price.unitPrice !== null)
        .map((price) => ({
          vehicle: WEBSITE_VEHICLES[price.vehicleType][language],
          price: `RMB ${price.unitPrice} PP`,
        })),
      notes: [
        template('peak-season'),
        template('hotel-substitution'),
        template('no-shopping'),
      ].filter(Boolean),
    };
  }
  const english = output('en');
  const chinese = output('zh');
  return {
    itineraryId: itinerary.id,
    sourceVersion: itinerary.version,
    inquiryVersion: inquiry.version,
    configVersion: config.version,
    schemaVersion: 1,
    validationVersion: 1,
    issues,
    english,
    chinese,
  };
}
