import type { ReferencePrice } from './price-adjustments';
export type ItineraryStatus = 'draft' | 'quoted';

export type ItineraryItemType =
  'hotel' | 'attraction' | 'restaurant' | 'vehicle' | 'guide';
export type ItineraryDailyItemType = Extract<
  ItineraryItemType,
  'attraction' | 'restaurant'
>;
export type ItineraryPriceUnit = string;
export type ItineraryHotelTier =
  'international_five_star' | 'preferred_non_five_star';
export type ItineraryVehicleTier = VehicleServiceLevel;

export interface ItineraryHotelSelection extends ReferencePrice {
  destination: string;
  hotelId: string;
  hotelName: string;
  rating: string;
  breakfast: string;
  unit: ItineraryPriceUnit;
  unitCost: number;
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
export interface ItineraryVehicleArrangement {
  id: string;
  startDate: string;
  endDate: string;
  vehicles: ItineraryVehicleSelection[];
  totalPrice?: number | null;
}
export interface ItineraryVehiclePlan {
  pricingMode?: 'automatic' | 'manual' | 'unknown' | null;
  segmentTotal?: number | null;
  adjustmentReason?: string | null;
  tier: ItineraryVehicleTier;
  arrangements: ItineraryVehicleArrangement[];
  totalPrice: number | null;
}

export interface ItineraryPaxPrice {
  pax: number;
  adultUnitPrice: number | null;
}

export interface ItineraryStaffRoomCost {
  destination: string;
  total: number | null;
}

export interface ItineraryQuoteOption {
  id: string;
  hotelTier: ItineraryHotelTier;
  vehicleTier: ItineraryVehicleTier;
  paxPrices: ItineraryPaxPrice[];
}

export interface ItineraryQuoteSettings {
  mealOtherCost: number | null;
  mealOtherReason: string;
  attractionOtherCost: number | null;
  attractionOtherReason: string;
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

export type ItineraryQuoteLineType = 'adult' | 'child';

export interface ItineraryQuoteLine {
  type: ItineraryQuoteLineType;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface LegacyQuoteOptionCalculation {
  optionId: string;
  hotelTier: ItineraryHotelTier;
  vehicleTier: ItineraryVehicleTier;
  hotelCost: number;
  vehicleCost: number;
  commonGroupCost: number;
  baseGroupCost: number;
  baseCostPerPerson: number;
  singleSupplementUnitCost: number;
  adultUnitPrice: number;
  childUnitPrice: number;
  totalPrice: number;
  profit: number;
  actualMarginRate: number;
  lines: ItineraryQuoteLine[];
}

export interface LegacyQuoteCalculation {
  hotelGuestCount: number;
  hotelRoomCount: number;
  dailyResourceCost: number;
  guideCost: number;
  options: LegacyQuoteOptionCalculation[];
}

export interface ItineraryPaxCalculation {
  pax: number;
  vehicleUnitCost: number;
  guideServiceUnitCost: number;
  staffRoomUnitCost: number;
  baseCostPerPerson: number;
  adultUnitPrice: number;
  childUnitPrice: number;
  leaderUnitPrice: number;
  singleSupplementUnitCost: number;
  tipUnitPrice: number;
  profitPerPerson: number;
  actualMarginRate: number | null;
}

export interface ItineraryQuoteOptionCalculation {
  optionId: string;
  hotelTier: ItineraryHotelTier;
  vehicleTier: ItineraryVehicleTier;
  hotelCityCosts?: {
    destination: string;
    nights: number;
    unitCost: number;
    totalCost: number;
  }[];
  hotelUnitCost: number;
  vehicleTotal: number;
  staffRoomTotal: number;
  paxPrices: ItineraryPaxCalculation[];
}

export interface PaxQuoteCalculation {
  pricingVersion: 2;
  dailyResourceCost: number;
  mealDetails?: {
    dayNumber: number;
    resourceName: string;
    unitCost: number;
    quantity: number;
    totalCost: number;
  }[];
  attractionDetails?: {
    dayNumber: number;
    resourceName: string;
    unitCost: number;
    quantity: number;
    totalCost: number;
  }[];
  mealCost?: number;
  attractionCost?: number;
  guideCost: number;
  options: ItineraryQuoteOptionCalculation[];
}

export type ItineraryQuoteCalculation =
  PaxQuoteCalculation | LegacyQuoteCalculation;

export interface ItineraryResourceItem extends ReferencePrice {
  id: string;
  type: ItineraryItemType;
  /** Both IDs are null for an itinerary-only custom restaurant. */
  resourceId: string | null;
  resourcePriceId: string | null;
  resourceName: string;
  priceName: string;
  quantity: number;
  dinerCount: number | null;
  unit: ItineraryPriceUnit;
  unitCost: number;
  totalCost: number;
  remark: string;
  mealSlot?: MealSlot;
}

export interface ItineraryDayRecord {
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
  dailyPrice: number;
  serviceDays: number;
}

export interface ItineraryRecord {
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
  destinations: string[];
  hotelPlans: ItineraryHotelPlan[];
  vehiclePlans: ItineraryVehiclePlan[];
  quote: ItineraryQuoteSettings;
  dailyPlans: ItineraryDayRecord[];
  status: ItineraryStatus;
  quoteGeneratedAt: string;
  creator: string;
  createdAt: string;
  updatedAt: string;
}
type VehicleServiceLevel = 'standard' | 'vip';
