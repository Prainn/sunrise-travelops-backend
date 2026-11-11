import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsDefined,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Matches,
  ValidateIf,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
export const ACTIONS = [
  'inquiry_created',
  'inquiry_updated',
  'itinerary_created',
  'itinerary_saved',
  'itinerary_pdf_generated',
  'inquiry_archived',
  'inquiry_lost',
] as const;
export type LogAction = (typeof ACTIONS)[number];
export class VersionDto {
  @IsInt() @Min(1) version: number;
}
export class InquiryInput {
  @IsOptional() @IsBoolean() isSeries?: boolean;
  @ValidateIf((o: InquiryInput) => !o.isSeries || o.agencyId !== undefined)
  @IsUUID()
  agencyId: string;
  @ValidateIf((o: InquiryInput) => !o.isSeries || o.contactId !== undefined)
  @IsUUID()
  contactId: string;
  @IsUUID() countryItemId: string;
  @IsOptional() @IsUUID() ownerId?: string;
  @IsOptional() @IsIn(['shengxu', 'linxi', 'website']) businessUnit?:
    'shengxu' | 'linxi' | 'website';
  @ValidateIf((o: InquiryInput) => !o.isSeries || o.sourceChannel !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  sourceChannel: string;
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(200000)
  originalMessage = '';
  @IsString() @MaxLength(20000) internalRemark = '';
  @ValidateIf((o: InquiryInput) => !o.isSeries || o.plannedDays !== undefined)
  @IsInt()
  @Min(1)
  @Max(365)
  plannedDays: number;
  @IsOptional() @IsDateString() nextFollowUpAt?: string | null;
  @IsOptional() @IsIn(['new', 'planning', 'quoted', 'lost']) status?: string;
  @IsString() @MaxLength(2000) lostReason = '';
}
export class UpdateInquiryDto extends InquiryInput {
  @IsInt() @Min(1) version: number;
}
export class FollowUpInput extends VersionDto {
  @IsUUID() requestId: string;
  @IsString() @MaxLength(20000) remark: string;
  @IsOptional()
  @IsDateString()
  @Matches(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/,
  )
  nextFollowUpAt?: string | null;
  @IsOptional() @IsIn([1, 3, 5, 15]) reminderDays?: 1 | 3 | 5 | 15 | null;
}
export class InquiryQuery extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['shengxu', 'linxi', 'website'])
  businessUnit?: 'shengxu' | 'linxi' | 'website';
  @IsOptional() @IsString() @MaxLength(50) code?: string;
  @IsOptional()
  @IsIn(['new', 'planning', 'quoted', 'lost', 'archived'])
  status?: string;
  @IsOptional() @IsUUID() ownerId?: string;
  @IsOptional() @IsString() sourceChannel?: string;
}
export class LogQuery extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['shengxu', 'linxi', 'website'])
  businessUnit?: 'shengxu' | 'linxi' | 'website';
  @IsOptional() @IsString() @MaxLength(50) inquiryCode?: string;
  @IsOptional() @IsUUID() inquiryId?: string;
  @IsOptional() @IsUUID() operatorId?: string;
  @IsOptional() @IsIn(ACTIONS) action?: LogAction;
  @IsOptional() @IsDateString({ strict: true }) @MaxLength(10) from?: string;
  @IsOptional() @IsDateString({ strict: true }) @MaxLength(10) to?: string;
}
export class ContactInput {
  @IsOptional() @IsUUID() inquiryId?: string;
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(50)
  phone: string;
}
class PriceInput {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1e9)
  referencePrice?: number | null;
  @IsOptional()
  @IsIn(['hotel_individual', 'hotel_group', 'resource_price', 'unknown'])
  referenceBasis?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) adjustmentReason?: string | null;
}
class ItemInput extends PriceInput {
  @IsOptional() @IsString() @MaxLength(500) resourceNameEn?: string;
  @IsOptional() @IsString() @MaxLength(10000) remarkEn?: string;
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  id: string;
  @IsIn(['restaurant', 'attraction']) type: 'restaurant' | 'attraction';
  @ValidateIf(
    (item: ItemInput) =>
      !(item.type === 'restaurant' && item.resourceId === null),
  )
  @IsUUID()
  resourceId: string | null;
  @IsString() @MaxLength(500) resourceName: string;
  @IsString() @MaxLength(500) priceName: string;
  @IsInt() @Min(1) @Max(1) quantity: number;
  @IsOptional() @IsInt() @Min(1) @Max(10000) tableCount?: number | null;
  @IsOptional() @IsInt() @Min(1) @Max(10000) dinerCount: number | null;
  @IsString() @MaxLength(100) unit: string;
  @ValidateIf((_object, value: unknown) => value !== null)
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1e9)
  unitCost: number | null;
  @ValidateIf((_object, value: unknown) => value !== null)
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1e12)
  totalCost: number | null;
  @IsString() @MaxLength(10000) remark: string;
  @IsOptional() @IsIn(['lunch', 'dinner']) mealSlot?: 'lunch' | 'dinner';
}
class MealsInput {
  @IsBoolean() breakfast: boolean;
  @IsBoolean() lunch: boolean;
  @IsBoolean() dinner: boolean;
}
class DayInput {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(365)
  @ArrayUnique()
  @IsString({ each: true })
  viaDestinations?: string[];
  @IsOptional() @IsString() @MaxLength(300) departureEn?: string;
  @IsOptional() @IsString() @MaxLength(300) destinationEn?: string;
  @IsOptional() @IsString() @MaxLength(100) transportEn?: string;
  @IsOptional() @IsString() @MaxLength(20000) descriptionEn?: string;
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  id: string;
  @IsInt() @Min(1) @Max(365) dayNumber: number;
  @IsDateString() date: string;
  @IsString() @MaxLength(300) departure: string;
  @IsString() @MaxLength(300) destination: string;
  @IsOptional() @IsString() @MaxLength(100) overnightDestination: string | null;
  @IsDefined() @ValidateNested() @Type(() => MealsInput) meals: MealsInput;
  @IsString() @MaxLength(100) transport: string;
  @IsOptional() @IsString() @MaxLength(20000) description?: string;
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ItemInput)
  items: ItemInput[];
}
class HotelInput extends PriceInput {
  @IsString() @MaxLength(100) destination: string;
  @IsUUID() hotelId: string;
  @IsString() @MaxLength(500) hotelName: string;
  @IsIn([3, 4, 5]) rating: number;
  @IsString() @MaxLength(10000) breakfast: string;
  @IsString() @MaxLength(100) unit: string;
  @ValidateIf((_object, value: unknown) => value !== null)
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1e9)
  unitCost: number | null;
}
class HotelPlanInput {
  @IsIn([3, 4, 5]) tier: 3 | 4 | 5;
  @IsArray()
  @ArrayMaxSize(365)
  @ValidateNested({ each: true })
  @Type(() => HotelInput)
  hotels: HotelInput[];
}
class VehicleInput {
  @IsUUID() vehicleId: string;
  @IsString() @MaxLength(500) vehicleName: string;
  @IsInt() @Min(1) seats: number;
  @IsInt() @Min(1) @Max(10000) quantity: number;
}
class VehiclePaxSegmentPriceInput {
  @IsInt() @Min(1) @Max(10000) pax: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1e9)
  totalPrice: number | null;
}
class VehiclePaxPriceInput extends VehiclePaxSegmentPriceInput {
  @IsIn(['automatic', 'manual']) pricingMode: 'automatic' | 'manual';
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) segmentTotal?:
    number | null;
  @IsOptional() @IsString() @MaxLength(2000) adjustmentReason?: string | null;
}
class VehicleArrangementInput {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => VehiclePaxSegmentPriceInput)
  paxPrices?: VehiclePaxSegmentPriceInput[];
  @IsString() @MinLength(1) @MaxLength(100) id: string;
  @IsString()
  @MaxLength(10)
  @ValidateIf((_object, value: unknown) => value !== '')
  @IsDateString({ strict: true })
  startDate: string;
  @IsString()
  @MaxLength(10)
  @ValidateIf((_object, value: unknown) => value !== '')
  @IsDateString({ strict: true })
  endDate: string;
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => VehicleInput)
  vehicles: VehicleInput[];
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(1e9) totalPrice?:
    number | null;
}
class VehiclePlanInput {
  @IsOptional() @IsIn(['itinerary', 'stage']) quotationMode?:
    'itinerary' | 'stage' | null;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => VehiclePaxPriceInput)
  paxPrices?: VehiclePaxPriceInput[];
  @IsOptional() @IsIn(['automatic', 'manual', 'unknown']) pricingMode?:
    'automatic' | 'manual' | 'unknown' | null;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) segmentTotal?:
    number | null;
  @IsOptional() @IsString() @MaxLength(2000) adjustmentReason?: string | null;
  @IsIn(['standard', 'vip']) tier: 'standard' | 'vip';
  @IsArray()
  @ArrayMaxSize(365)
  @ValidateNested({ each: true })
  @Type(() => VehicleArrangementInput)
  arrangements: VehicleArrangementInput[];
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(1e9) totalPrice:
    number | null;
}
class GuideInput extends PriceInput {
  @IsString() @MaxLength(100) destination: string;
  @IsUUID() guideId: string;
  @IsString() @MaxLength(500) guideName: string;
  @IsString() @MaxLength(20) secondLanguage: string;
  @IsBoolean() shopping: boolean;
  @ValidateIf((_object, value: unknown) => value !== null)
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1e9)
  dailyPrice: number | null;
  @IsInt() @Min(1) @Max(365) serviceDays: number;
}
class PaxPriceInput {
  @IsInt() @Min(1) @Max(10000) pax: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1e9)
  adultUnitPrice: number | null;
}
class StaffRoomCostInput {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  destination: string;
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1e9)
  total: number | null;
}
class QuoteOptionInput {
  @IsString() @MinLength(1) @MaxLength(100) id: string;
  @IsIn([null, 3, 4, 5]) hotelTier: 3 | 4 | 5 | null;
  @IsIn(['standard', 'vip']) vehicleTier: 'standard' | 'vip';
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PaxPriceInput)
  paxPrices: PaxPriceInput[];
}
class TransportFeeInput {
  @IsOptional() @IsString() @MaxLength(100) departureCityEn?: string;
  @IsOptional() @IsString() @MaxLength(100) arrivalCityEn?: string;
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  id: string;
  @IsIn(['flight', 'train']) type: 'flight' | 'train';
  @IsString() @MaxLength(100) departureCity: string;
  @IsString() @MaxLength(100) arrivalCity: string;
  @IsIn(['economy', 'business', 'first', 'second']) cabin:
    'economy' | 'business' | 'first' | 'second';
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(1e9) unitPrice:
    number | null;
}
class PaxOtherCostInput {
  @IsInt() @Min(1) @Max(10000) pax: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1e9)
  guideOtherCost: number | null = null;
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  guideOtherReason: string = '';
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1e9)
  staffRoomOtherCost: number | null = null;
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  staffRoomOtherReason: string = '';
}
class QuoteInput {
  @IsOptional() @IsString() @MaxLength(20000) customerNotesEn?: string;
  @IsOptional() @IsString() @MaxLength(10000) holidayRestrictionsEn?: string;
  @IsOptional() @IsString() @MaxLength(10000) hotelReplacementTermsEn?: string;
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1e9)
  mealOtherCost: number | null = null;
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  mealOtherReason: string = '';
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1e9)
  attractionOtherCost: number | null = null;
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  attractionOtherReason: string = '';
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PaxOtherCostInput)
  paxOtherCosts: PaxOtherCostInput[] = [];

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => StaffRoomCostInput)
  staffRoomCosts: StaffRoomCostInput[];

  @IsArray()
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => QuoteOptionInput)
  options: QuoteOptionInput[];
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(1e9) chineseTip:
    number | null;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(1e9) englishTip:
    number | null;
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => TransportFeeInput)
  transportFees: TransportFeeInput[];
  @IsString() @MaxLength(20000) customerNotes: string;
  @IsString() @MaxLength(10000) holidayRestrictions: string;
  @IsString() @MaxLength(10000) hotelReplacementTerms: string;
}
class DeletedDayInput {
  @IsDefined() @ValidateNested() @Type(() => DayInput) day: DayInput;
  @IsDefined()
  @ValidateIf((o: DeletedDayInput) => o.originalDate !== null)
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  originalDate: string | null;
}
export class ItineraryInput {
  @IsOptional() @IsString() @MaxLength(300) titleEn?: string;
  @IsOptional() @IsIn(['same', 'returnArrival']) customerDisplayMode?:
    'same' | 'returnArrival';
  @IsOptional() @IsString() @MaxLength(2000) returnArrivalText?: string;
  @IsOptional() @IsString() @MaxLength(2000) returnArrivalTextEn?: string;
  /** Request-only acknowledgement; consumed before persistence and auditing. */
  @IsOptional() @IsBoolean() confirmVehicleModeChange?: boolean;
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  title: string;
  @IsDateString({ strict: true }) @MaxLength(10) startDate: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(10000, { each: true })
  paxTiers: number[];
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) childRate: number;
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  childWithoutBedRate: number;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(365)
  @ArrayUnique()
  @IsString({ each: true })
  destinations: string[];
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(365)
  @ValidateNested({ each: true })
  @Type(() => DayInput)
  dailyPlans: DayInput[];
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeletedDayInput)
  deletedDays?: DeletedDayInput[] = [];
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => HotelPlanInput)
  hotelPlans: HotelPlanInput[];
  @IsArray()
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => VehiclePlanInput)
  vehiclePlans: VehiclePlanInput[];
  @IsArray()
  @ArrayMaxSize(1)
  @ValidateNested({ each: true })
  @Type(() => GuideInput)
  guidePlans: GuideInput[];
  @IsDefined() @ValidateNested() @Type(() => QuoteInput) quote: QuoteInput;
}
export class UpdateItineraryDto extends ItineraryInput {
  @IsInt() @Min(1) version: number;
}
export class CopyItineraryDto extends VersionDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  title: string;
}
export class ExportQueryDto {
  @IsOptional() @IsIn(['zh', 'en']) language?: 'zh' | 'en';
}
export class ConfirmPdfDto extends VersionDto {
  @IsOptional() @IsIn(['zh', 'en']) language?: 'zh' | 'en';
  @IsInt() @Min(1) inquiryVersion: number;
}

export class TransferInquiryDto extends VersionDto {
  @IsUUID() ownerId: string;
  @IsString()
  @MaxLength(2000)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @MinLength(1)
  reason: string;
}
