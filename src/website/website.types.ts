export type FeeState =
  | 'INCLUDED'
  | 'EXCLUDED'
  | 'OPTIONAL'
  | 'RECOMMENDED'
  | 'ARRANGED'
  | 'SELF_PAY'
  | 'UNKNOWN';
export type TransportMode = 'hsr' | 'private_vehicle' | 'flight' | 'other';
export type VehicleType =
  '5_seat' | '7_seat' | '9_seat' | '14_seat' | '18_seat';
export type ConfigStatus = 'enabled' | 'disabled';
export interface ConfigBase {
  id: string;
  status: ConfigStatus;
}
export interface WebsiteCity extends ConfigBase {
  nameZh: string;
  nameEn: string;
  resourceId: string | null;
}
export interface WebsiteAttraction extends ConfigBase {
  cityId: string;
  parentId: string | null;
  nameZh: string;
  nameEn: string;
  resourceId: string | null;
  kind: 'attraction' | 'component';
  chargeable: boolean;
  copyKey: string;
  recommendedMonths: number[];
}
export interface WebsiteRoute extends ConfigBase {
  fromCityId: string;
  toCityId: string;
  mode: TransportMode;
  nameZh: string;
  nameEn: string;
  feeState: FeeState;
}
export interface WebsitePattern extends ConfigBase {
  cityId: string;
  nameZh: string;
  nameEn: string;
  attractionIds: string[];
}
export interface WebsiteSkeleton extends ConfigBase {
  nameZh: string;
  nameEn: string;
  days: Array<{ cityId: string; patternId: string | null }>;
}
export interface WebsiteTemplate extends ConfigBase {
  name: string;
  code: string;
  zh: string;
  en: string;
}
export interface WebsiteConfig {
  version: number;
  cities: WebsiteCity[];
  attractions: WebsiteAttraction[];
  routes: WebsiteRoute[];
  patterns: WebsitePattern[];
  skeletons: WebsiteSkeleton[];
  templates: WebsiteTemplate[];
}
export interface WebsiteInquiryInput {
  countryItemId: string;
  customerName: string;
  plannedDays: number;
  requirements: string;
  ownerId?: string;
  phone: string;
  email: string;
  startDate: string | null;
  pax: number | null;
  arrivalTime: string;
  departureTime: string;
  destinations: string[];
  internalRemark: string;
  status?: 'new' | 'planning' | 'quoted' | 'lost' | 'archived';
  lostReason: string;
}
export interface WebsiteInquiry extends WebsiteInquiryInput {
  hasActiveTour: boolean;
  countryCode: string | null;
  countryOrRegion: string;
  id: string;
  code: string;
  ownerId: string;
  owner: string;
  status: 'new' | 'planning' | 'quoted' | 'lost' | 'archived';
  version: number;
  createdAt: string;
  updatedAt: string;
}
export interface WebsiteItem {
  id: string;
  attractionId: string | null;
  nameZh: string;
  nameEn: string;
  descriptionZh: string;
  descriptionEn: string;
  appears: boolean;
  feeState: FeeState;
}
export interface WebsiteLeg {
  id: string;
  routeId: string | null;
  fromCityId: string;
  toCityId: string;
  mode: TransportMode;
  nameZh: string;
  nameEn: string;
  feeState: FeeState;
}
export interface WebsiteHotelStay {
  id: string;
  tier: 'A' | 'B';
  cityId: string;
  resourceId: string | null;
  nameZh: string;
  nameEn: string;
  roomType: string;
  breakfastIncluded: boolean;
}
export interface WebsiteMeal {
  id: string;
  slot: 'breakfast' | 'lunch' | 'dinner';
  resourceId: string | null;
  restaurantZh: string;
  restaurantEn: string;
  feeState: FeeState;
}
export interface WebsiteService {
  id: string;
  nameZh: string;
  nameEn: string;
  appears: boolean;
  feeState: FeeState;
}
export interface WebsiteDay {
  id: string;
  dayNumber: number;
  departCityId: string;
  endCityId: string;
  overnightCityId: string | null;
  items: WebsiteItem[];
  legs: WebsiteLeg[];
  hotels: WebsiteHotelStay[];
  meals: WebsiteMeal[];
  guideLanguage: string;
  guideScope: string;
  services: WebsiteService[];
}
export interface WebsiteVehiclePrice {
  vehicleType: VehicleType;
  unitPrice: string | null;
}
export interface WebsiteItineraryInput {
  title: string;
  duration: number;
  startDate: string | null;
  pax: number | null;
  arrivalTime: string;
  departureTime: string;
  configVersion: number;
  days: WebsiteDay[];
  vehiclePrices: WebsiteVehiclePrice[];
}
export interface WebsiteItinerary extends WebsiteItineraryInput {
  id: string;
  inquiryId: string;
  code: string;
  status: 'draft' | 'quoted';
  version: number;
  createdAt: string;
  updatedAt: string;
}
export interface WebsiteValidation {
  code: string;
  severity: 'ERROR' | 'WARNING';
  message: string;
  dayNumber?: number;
}
export interface WebsiteOutputDay {
  day: string;
  depart: string;
  transportation: string;
  sightseeing: string;
  hotel: string;
  meal: string;
}
export interface WebsiteOutput {
  title: string;
  itinerary: WebsiteOutputDay[];
  inclusions: string[];
  exclusions: string[];
  hotelOptions: Array<{
    tier: 'A' | 'B';
    city: string;
    hotel: string;
    roomType: string;
  }>;
  quotation: Array<{ vehicle: string; price: string }>;
  notes: string[];
}
export interface WebsitePreview {
  itineraryId: string;
  sourceVersion: number;
  inquiryVersion: number;
  configVersion: number;
  schemaVersion: 1;
  validationVersion: 1;
  issues: WebsiteValidation[];
  english: WebsiteOutput;
  chinese: WebsiteOutput;
}
export interface WebsiteQuotation extends WebsitePreview {
  id: string;
  code: string;
  confirmedAt: string;
  confirmedBy: string;
  acknowledgedWarnings: string[];
}
export interface WebsiteLog {
  id: string;
  action: string;
  targetId: string;
  actorName: string;
  occurredAt: string;
  detail: string;
}
