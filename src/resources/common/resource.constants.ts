export enum ResourceStatus {
  Enabled = 'enabled',
  Disabled = 'disabled',
}

export const ATTRACTION_CATEGORIES = [
  'scenic',
  'performance',
  'experience',
  'transport',
  'package',
] as const;
export type AttractionCategory = (typeof ATTRACTION_CATEGORIES)[number];
