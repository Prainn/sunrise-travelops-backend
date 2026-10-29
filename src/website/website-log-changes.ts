import { diffChanges } from '../inquiries/changes';
import type {
  WebsiteInquiry,
  WebsiteItinerary,
  WebsiteLogChange,
} from './website.types';

type LogTarget = WebsiteInquiry | WebsiteItinerary;

function inquiryContent(value: WebsiteInquiry) {
  return {
    businessUnit: value.businessUnit,
    customerName: value.customerName,
    countryItemId: value.countryItemId,
    countryCode: value.countryCode,
    countryOrRegion: value.countryOrRegion,
    plannedDays: value.plannedDays,
    requirements: value.requirements,
    ownerId: value.ownerId,
    owner: value.owner,
    contactInfo: value.contactInfo,
    receivedAt: value.receivedAt,
    contactChannel: value.contactChannel,
    whatsappSourceId: value.whatsappSourceId,
    websiteInquiryNo: value.websiteInquiryNo,
    landingPage: value.landingPage,
    acquisitionSource: value.acquisitionSource,
    startDate: value.startDate,
    pax: value.pax,
    destinations: value.destinations,
    internalRemark: value.internalRemark,
    status: value.status,
    lostReason: value.lostReason,
  };
}

function itineraryContent(value: WebsiteItinerary) {
  return {
    title: value.title,
    duration: value.duration,
    startDate: value.startDate,
    pax: value.pax,
    configVersion: value.configVersion,
    status: value.status,
    days: value.days,
    reorderDraft: value.reorderDraft ?? null,
    deletedDays: [...(value.deletedDays ?? [])]
      .sort((a, b) => a.day.id.localeCompare(b.day.id))
      .map((entry) => ({
        id: entry.day.id,
        ...entry,
      })),
    // The database canonicalizes money and sorts vehicle prices by type.
    // Key by vehicle type so repricing is a field change, not an array replacement.
    vehiclePrices: Object.fromEntries(
      value.vehiclePrices.map((price) => [
        JSON.stringify([price.vehicleType, price.hotelTier]),
        {
          vehicleType: price.vehicleType,
          hotelTier: price.hotelTier,
          unitPrice: price.unitPrice,
          priceComponents: Object.fromEntries(
            (price.priceComponents ?? []).map((component) => [
              component.category,
              {
                unitPrice: component.unitPrice,
                showInPdf: component.showInPdf,
              },
            ]),
          ),
          includesDriver: price.includesDriver,
          includesGuide: price.includesGuide,
        },
      ]),
    ),
  };
}

function content(value: LogTarget) {
  return 'inquiryId' in value ? itineraryContent(value) : inquiryContent(value);
}

/** Compare persisted business values; never infer historical values from live resources. */
export function websiteLogChanges(
  before: LogTarget | undefined,
  after: LogTarget,
): WebsiteLogChange[] {
  const changes = diffChanges(before ? content(before) : {}, content(after));
  const plans = [after, before].filter(
    (value): value is WebsiteItinerary => !!value && 'inquiryId' in value,
  );
  return changes
    .filter((change) => before !== undefined || !isEmpty(change.after))
    .map((change) => {
      const context: NonNullable<WebsiteLogChange['context']> = {};
      const match = change.path.match(/^(days|deletedDays)\[([^\]]+)\]/);
      if (match) {
        const days = plans
          .flatMap((plan) =>
            match[1] === 'days'
              ? plan.days
              : (plan.deletedDays ?? []).map((entry) => entry.day),
          )
          .filter((day) => day.id === match[2]);
        if (days[0]) context.dayNumber = days[0].dayNumber;
        const itemMatch = change.path.match(
          /\.(items|legs|hotels|meals|services)\[([^\]]+)\]/,
        );
        if (itemMatch) {
          const collection = itemMatch[1] as
            'items' | 'legs' | 'hotels' | 'meals' | 'services';
          const item = days
            .flatMap((day) => [...day[collection]])
            .find((value) => value.id === itemMatch[2]);
          if (item) {
            context.nameZh = 'nameZh' in item ? item.nameZh : item.restaurantZh;
            context.nameEn = 'nameEn' in item ? item.nameEn : item.restaurantEn;
            if ('tier' in item) context.hotelTier = item.tier;
            if ('slot' in item) context.mealSlot = item.slot;
          }
        }
      }
      const price = plans
        .flatMap((plan) => plan.vehiclePrices)
        .find((price) =>
          change.path.startsWith(
            `vehiclePrices.${JSON.stringify([price.vehicleType, price.hotelTier])}`,
          ),
        );
      if (price?.vehicleType) context.vehicleType = price.vehicleType;
      if (price?.hotelTier) context.hotelTier = price.hotelTier;
      return {
        path: change.path,
        kind: change.kind,
        before: change.before,
        after: change.after,
        ...(Object.keys(context).length ? { context } : {}),
      };
    });
}

function isEmpty(value: unknown): boolean {
  return (
    value == null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0) ||
    (typeof value === 'object' && Object.keys(value).length === 0)
  );
}
