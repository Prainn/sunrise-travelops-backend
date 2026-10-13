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

export type AttractionPriceItemType = string;
