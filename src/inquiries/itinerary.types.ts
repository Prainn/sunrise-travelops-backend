import type { ReferencePrice } from './price-adjustments';
export type ItineraryStatus = 'draft' | 'quoted';

export type ItineraryItemType =
  'hotel' | 'attraction' | 'restaurant' | 'vehicle' | 'guide';
export type ItineraryPriceUnit = string;
export type ItineraryHotelTier = 3 | 4 | 5;
export type ItineraryVehicleTier = VehicleServiceLevel;

export interface ItineraryHotelSelection extends ReferencePrice {
  /** Active day this hotel night belongs to; absent only in older frozen snapshots. */
  dayId?: string;
  /** Overnight city of that day. */
  destination: string;
  hotelId: string;
  hotelName: string;
  rating: number;
  breakfast: string;
  unit: ItineraryPriceUnit;
  unitCost: number | null;
}

export interface ItineraryHotelPlan {
  tier: ItineraryHotelTier;
  hotels: ItineraryHotelSelection[];
}

export interface ItineraryVehicleSelection {
  vehicleId: string;
  vehicleName: string;
  seats: number;
  quantity: number;
}
interface VehiclePrice {
  pax: number;
  totalPrice: number | null;
}
export interface VehiclePaxSegmentPrice extends VehiclePrice {
  /** Present in itinerary mode for snapshots with PAX-specific vehicles. */
  vehicles?: ItineraryVehicleSelection[];
}
export interface VehiclePaxPrice extends VehiclePrice {
  pricingMode: 'automatic' | 'manual';
  segmentTotal?: number | null;
  adjustmentReason?: string | null;
}
export interface ItineraryVehicleArrangement {
  paxPrices?: VehiclePaxSegmentPrice[];
  id: string;
  startDate: string;
  endDate: string;
  vehicles: ItineraryVehicleSelection[];
  totalPrice?: number | null;
}
export interface ItineraryVehiclePlan {
  quotationMode: 'itinerary' | 'stage';
  paxPrices?: VehiclePaxPrice[];
  pricingMode?: 'automatic' | 'manual' | 'unknown' | null;
  segmentTotal?: number | null;
  adjustmentReason?: string | null;
  tier: ItineraryVehicleTier;
  arrangements: ItineraryVehicleArrangement[];
  totalPrice: number | null;
}

export interface ItineraryPaxPrice {
  singleSupplementQuote?: number | null;
  pax: number;
  adultUnitPrice: number | null;
}

export interface ItineraryStaffRoomCost {
  destination: string;
  total: number | null;
}

/** Other costs are group totals; per-person cost is total / PAX of the tier. */
export interface ItineraryPaxOtherCost {
  pax: number;
  guideOtherCost: number | null;
  guideOtherReason: string;
  staffRoomOtherCost: number | null;
  staffRoomOtherReason: string;
}

export interface ItineraryQuoteOption {
  id: string;
  hotelTier: ItineraryHotelTier | null;
  vehicleTier: ItineraryVehicleTier;
  paxPrices: ItineraryPaxPrice[];
}

export interface ItineraryQuoteSettings {
  leaderRoomTotal?: number | null;
  driverTipTotal?: number | null;
  guideLeaderTransportTotal?: number | null;
  groundHandlingUnitCost?: number | null;
  customerNotesEn?: string;
  holidayRestrictionsEn?: string;
  hotelReplacementTermsEn?: string;
  mealOtherCost: number | null;
  mealOtherReason: string;
  attractionOtherCost: number | null;
  attractionOtherReason: string;
  paxOtherCosts: ItineraryPaxOtherCost[];
  staffRoomCosts: ItineraryStaffRoomCost[];
  options: ItineraryQuoteOption[];
  /** Full-tour tip per adult/child, charged separately and included in profit. */
  chineseTip: number | null;
  /** Full-tour tip per adult/child, charged separately and included in profit. */
  englishTip: number | null;
  transportFees: ItineraryTransportFee[];
  customerNotes: string;
  holidayRestrictions: string;
  hotelReplacementTerms: string;
}

export interface ItineraryTransportFee {
  departureCityEn?: string;
  arrivalCityEn?: string;
  id: string;
  type: 'flight' | 'train';
  departureCity: string;
  arrivalCity: string;
  cabin: 'economy' | 'business' | 'first' | 'second';
  unitPrice: number | null;
}

export type MealSlot = 'lunch' | 'dinner';
export interface ItineraryMeals {
  breakfast: boolean;
  lunch: boolean;
  dinner: boolean;
}

export interface ItineraryPaxCalculation {
  leaderRoomUnitCost?: number;
  driverTipUnitCost?: number;
  guideLeaderTransportUnitCost?: number;
  groundHandlingUnitCost?: number;
  singleSupplementQuote?: number;
  pax: number;
  /** Exact group vehicle price for this PAX; absent in historical freezes. */
  vehicleTotal?: number | null;
  vehicleUnitCost: number;
  guideServiceUnitCost: number;
  staffRoomUnitCost: number;
  baseCostPerPerson: number;
  mealCost?: number;
  /** Per-person attraction cost incl. other costs of this PAX; older snapshots omit it. */
  attractionCost?: number;
  adultUnitPrice: number;
  childUnitPrice: number;
  childWithoutBedUnitPrice?: number;
  leaderUnitPrice: number;
  singleSupplementUnitCost: number;
  tipUnitPrice: number;
  profitPerPerson: number;
  actualMarginRate: number | null;
}

export interface ItineraryQuoteOptionCalculation {
  optionId: string;
  hotelTier: ItineraryHotelTier | null;
  vehicleTier: ItineraryVehicleTier;
  /** One row per overnight day since per-day hotels; older snapshots group by city. */
  hotelCityCosts?: {
    dayNumber?: number;
    hotelName?: string | null;
    destination: string;
    nights: number;
    unitCost: number | null;
    totalCost: number | null;
  }[];
  hotelUnitCost: number;
  vehicleTotal: number | null;
  staffRoomTotal: number;
  paxPrices: ItineraryPaxCalculation[];
}

export interface ItineraryQuoteCalculation {
  pricingVersion: 2;
  tableMealTotal?: number;
  /** Only the three Draft actual-price fields; historical snapshots may omit these. */
  pricingComplete?: boolean;
  missingPrices?: string[];
  dailyResourceCost: number;
  mealDetails?: {
    groupTotal?: number | null;
    city?: string | null;
    dayNumber: number;
    resourceName: string;
    unitCost: number | null;
    quantity: number;
    totalCost: number | null;
  }[];
  attractionDetails?: {
    city?: string | null;
    dayNumber: number;
    resourceName: string;
    unitCost: number | null;
    quantity: number;
    totalCost: number | null;
  }[];
  mealCost?: number;
  attractionCost?: number;
  guideCost: number;
  options: ItineraryQuoteOptionCalculation[];
}

export interface ItineraryResourceItem extends ReferencePrice {
  resourceNameEn?: string;
  remarkEn?: string;
  id: string;
  type: ItineraryItemType;
  /** Both IDs are null for an itinerary-only custom restaurant. */
  resourceId: string | null;
  resourceName: string;
  priceName: string;
  quantity: number;
  dinerCount: number | null;
  tableCount?: number | null;
  unit: ItineraryPriceUnit;
  unitCost: number | null;
  totalCost: number | null;
  remark: string;
  mealSlot?: MealSlot;
}

export interface ItineraryDayRecord {
  viaDestinations?: string[];
  departureEn?: string;
  destinationEn?: string;
  transportEn?: string;
  descriptionEn?: string;
  id: string;
  dayNumber: number;
  date: string;
  departure: string;
  destination: string;
  overnightDestination: string | null;
  meals: ItineraryMeals;
  transport: string;
  description?: string;
  items: ItineraryResourceItem[];
}

export interface ItineraryGuidePlan extends ReferencePrice {
  destination: string;
  guideId: string;
  guideName: string;
  secondLanguage: string;
  shopping: boolean;
  dailyPrice: number | null;
  serviceDays: number;
}

export interface ItineraryRecord {
  titleEn?: string;
  customerDisplayMode?: 'same' | 'returnArrival';
  returnArrivalText?: string;
  returnArrivalTextEn?: string;
  guidePlans: ItineraryGuidePlan[];
  id: string;
  inquiryId: string;
  code: string;
  title: string;
  startDate: string;
  endDate: string;
  days: number;
  paxTiers: number[];
  childRate: number;
  childWithoutBedRate: number;
  destinations: string[];
  hotelPlans: ItineraryHotelPlan[];
  vehiclePlans: ItineraryVehiclePlan[];
  quote: ItineraryQuoteSettings;
  dailyPlans: ItineraryDayRecord[];
  deletedDays?: { day: ItineraryDayRecord; originalDate: string | null }[];
  status: ItineraryStatus;
  quoteGeneratedAt: string;
  creator: string;
  createdAt: string;
  updatedAt: string;
}
type VehicleServiceLevel = 'standard' | 'vip';
