export enum BusinessDictionaryStatus {
  Enabled = 'enabled',
  Disabled = 'disabled',
}

export const BUSINESS_RESOURCE_TYPES = [
  'hotel',
  'attraction',
  'restaurant',
  'vehicle',
  'guide',
] as const;

export type BusinessResourceType = (typeof BUSINESS_RESOURCE_TYPES)[number];
