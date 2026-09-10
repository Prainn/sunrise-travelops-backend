export type ItineraryStatus =
  'draft' | 'ready_for_costing' | 'quoted' | 'archived';

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

export interface ItineraryHotelSelection {
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
  tier: ItineraryVehicleTier;
  arrangements: ItineraryVehicleArrangement[];
  totalPrice: number | null;
}

export interface ItineraryQuoteOption {
  id: string;
  hotelTier: ItineraryHotelTier;
  vehicleTier: ItineraryVehicleTier;
  adultUnitPrice: number | null;
  leaderFocEnabled: boolean;
}

export interface ItineraryQuoteSettings {
  options: ItineraryQuoteOption[];
  chineseTip: number | null;
  englishTip: number | null;
  transportFees: ItineraryTransportFee[];
  otherExpenses: number;
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

export interface ItineraryQuoteOptionCalculation {
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

export interface ItineraryQuoteCalculation {
  hotelGuestCount: number;
  hotelRoomCount: number;
  dailyResourceCost: number;
  guideCost: number;
  options: ItineraryQuoteOptionCalculation[];
}

export interface ItineraryResourceItem {
  id: string;
  type: ItineraryItemType;
  resourceId: string;
  resourcePriceId: string;
  resourceName: string;
  priceName: string;
  quantity: number;
  unit: ItineraryPriceUnit;
  referenceUnitCost?: number;
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

export interface ItineraryGuidePlan {
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
  adults: number;
  childrenCount: number;
  leaderCount: number;
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
