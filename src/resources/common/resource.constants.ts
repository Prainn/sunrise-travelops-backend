export enum ResourceStatus {
  Enabled = 'enabled',
  Disabled = 'disabled',
}

export const RESOURCE_STATUSES = Object.values(ResourceStatus);

export const ATTRACTION_CATEGORIES = [
  'scenic',
  'performance',
  'experience',
  'transport',
  'package',
] as const;
export type AttractionCategory = (typeof ATTRACTION_CATEGORIES)[number];

export const ATTRACTION_PRICE_ITEM_TYPES = [
  'ticket',
  'transport',
  'guide',
  'activity',
  'package',
] as const;
export type AttractionPriceItemType =
  (typeof ATTRACTION_PRICE_ITEM_TYPES)[number];

export const GUIDE_GENDERS = ['male', 'female'] as const;
export type GuideGender = (typeof GUIDE_GENDERS)[number];

export const GUIDE_EMPLOYMENT_TYPES = ['full-time', 'part-time'] as const;
export type GuideEmploymentType = (typeof GUIDE_EMPLOYMENT_TYPES)[number];
