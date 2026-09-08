const RESOURCE_TYPES = [
  'city',
  'agency',
  'supplier',
  'hotel',
  'restaurant',
  'attraction',
  'transport',
  'guide',
] as const;

export const RESOURCE_PERMISSIONS = RESOURCE_TYPES.flatMap((resource) => [
  `resource:${resource}:list`,
  `resource:${resource}:create`,
  `resource:${resource}:update`,
  `resource:${resource}:delete`,
]);

export const INQUIRY_PERMISSIONS = [
  'inquiry:list',
  'inquiry:create',
  'inquiry:update',
  'itinerary:list',
  'itinerary:price',
] as const;

export const OPERATIONS_PERMISSIONS = [
  'inquiry:list',
  'inquiry:update',
  'itinerary:list',
  'itinerary:create',
  'itinerary:update',
  'itinerary:pdf',
] as const;

export const ADMIN_PERMISSIONS = [
  'sys:user:list',
  'sys:user:create',
  'sys:user:update',
  'sys:user:delete',
  'sys:user:import',
  'sys:user:export',
  'sys:user:reset-password',
  'sys:role:list',
  'sys:role:create',
  'sys:role:update',
  'sys:role:delete',
  'sys:dict:list',
  'sys:dict:create',
  'sys:dict:update',
  'sys:dict:delete',
  'sys:dict-item:list',
  'sys:dict-item:create',
  'sys:dict-item:update',
  'sys:dict-item:delete',
  'sys:business-dictionary:list',
  'sys:business-dictionary:create',
  'sys:business-dictionary:update',
  'sys:business-dictionary:delete',
  ...RESOURCE_PERMISSIONS,
  'inquiry:list',
  'inquiry:create',
  'inquiry:update',
  'inquiry:archive',
  'itinerary:list',
  'itinerary:create',
  'itinerary:update',
  'itinerary:price',
  'itinerary:pdf',
] as const;

export const PERMISSION_DEFINITIONS: Record<string, string> =
  Object.fromEntries(ADMIN_PERMISSIONS.map((code) => [code, code]));
