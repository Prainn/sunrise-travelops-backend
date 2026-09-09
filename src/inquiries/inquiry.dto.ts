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
  @IsUUID() agencyId: string;
  @IsUUID() contactId: string;
  @IsOptional() @IsUUID() ownerId?: string;
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
  @MinLength(1)
  @MaxLength(20000)
  originalMessage: string;
  @IsString() @MaxLength(20000) internalRemark = '';
  @IsInt() @Min(1) @Max(365) plannedDays: number;
  @IsOptional() @IsDateString() nextFollowUpAt?: string | null;
  @IsOptional() @IsIn(['new', 'planning', 'quoted', 'lost']) status?: string;
  @IsString() @MaxLength(2000) lostReason = '';
}
export class UpdateInquiryDto extends InquiryInput {
  @IsInt() @Min(1) version: number;
}
export class InquiryQuery extends PaginationQueryDto {
  @IsOptional() @IsString() @MaxLength(50) code?: string;
  @IsOptional()
  @IsIn(['new', 'planning', 'quoted', 'lost', 'archived'])
  status?: string;
  @IsOptional() @IsUUID() ownerId?: string;
  @IsOptional() @IsString() sourceChannel?: string;
}
export class LogQuery extends PaginationQueryDto {
  @IsOptional() @IsString() @MaxLength(50) inquiryCode?: string;
  @IsOptional() @IsUUID() inquiryId?: string;
  @IsOptional() @IsUUID() operatorId?: string;
  @IsOptional() @IsIn(ACTIONS) action?: LogAction;
  @IsOptional() @IsDateString({ strict: true }) @MaxLength(10) from?: string;
  @IsOptional() @IsDateString({ strict: true }) @MaxLength(10) to?: string;
}
export class ContactInput {
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
class ItemInput {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  id: string;
  @IsIn(['restaurant', 'attraction']) type: 'restaurant' | 'attraction';
  @IsUUID() resourceId: string;
  @IsUUID() resourcePriceId: string;
  @IsString() @MaxLength(500) resourceName: string;
  @IsString() @MaxLength(500) priceName: string;
  @IsNumber() @Min(0) @Max(100000) quantity: number;
  @IsString() @MaxLength(100) unit: string;
  @Type(() => Number) @IsNumber() @Min(0) @Max(1e9) unitCost: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1e9)
  referenceUnitCost?: number;
  @Type(() => Number) @IsNumber() @Min(0) @Max(1e12) totalCost: number;
  @IsString() @MaxLength(10000) remark: string;
  @IsOptional() @IsIn(['lunch', 'dinner']) mealSlot?: 'lunch' | 'dinner';
}
class MealsInput {
  @IsBoolean() breakfast: boolean;
  @IsBoolean() lunch: boolean;
  @IsBoolean() dinner: boolean;
}
class DayInput {
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
class HotelInput {
  @IsString() @MaxLength(100) destination: string;
  @IsUUID() hotelId: string;
  @IsString() @MaxLength(500) hotelName: string;
  @IsString() @MaxLength(100) rating: string;
  @IsString() @MaxLength(10000) breakfast: string;
  @IsString() @MaxLength(100) unit: string;
  @Type(() => Number) @IsNumber() @Min(0) @Max(1e9) unitCost: number;
}
class HotelPlanInput {
  @IsIn(['international_five_star', 'preferred_non_five_star']) tier:
    'international_five_star' | 'preferred_non_five_star';
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
class VehicleArrangementInput {
  @IsString() @MinLength(1) @MaxLength(100) id: string;
  @IsArray()
  @ArrayMaxSize(365)
  @ArrayUnique()
  @IsString({ each: true })
  dayIds: string[];
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => VehicleInput)
  vehicles: VehicleInput[];
}
class VehiclePlanInput {
  @IsIn(['standard', 'vip']) tier: 'standard' | 'vip';
  @IsArray()
  @ArrayMaxSize(365)
  @ValidateNested({ each: true })
  @Type(() => VehicleArrangementInput)
  arrangements: VehicleArrangementInput[];
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(1e9) totalPrice:
    number | null;
}
class GuideInput {
  @IsString() @MaxLength(100) destination: string;
  @IsUUID() guideId: string;
  @IsString() @MaxLength(500) guideName: string;
  @IsString() @MaxLength(20) secondLanguage: string;
  @IsBoolean() shopping: boolean;
  @Type(() => Number) @IsNumber() @Min(0) @Max(1e9) dailyPrice: number;
  @IsInt() @Min(1) @Max(365) serviceDays: number;
}
class QuoteOptionInput {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  id: string;
  @IsIn(['international_five_star', 'preferred_non_five_star']) hotelTier:
    'international_five_star' | 'preferred_non_five_star';
  @IsIn(['standard', 'vip']) vehicleTier: 'standard' | 'vip';
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1e9)
  adultUnitPrice: number | null;
  @IsBoolean() leaderFocEnabled: boolean;
}
class TransportFeeInput {
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
class QuoteInput {
  @Type(() => Number) @IsNumber() @Min(0) @Max(1e9) otherExpenses: number;
  @IsArray()
  @ArrayMaxSize(4)
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
export class ItineraryInput {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  title: string;
  @IsDateString({ strict: true }) @MaxLength(10) startDate: string;
  @IsInt() @Min(1) @Max(10000) adults: number;
  @IsInt() @Min(0) @Max(10000) childrenCount: number;
  @IsInt() @Min(0) @Max(10000) leaderCount: number;
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
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => HotelPlanInput)
  hotelPlans: HotelPlanInput[];
  @IsArray()
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => VehiclePlanInput)
  vehiclePlans: VehiclePlanInput[];
  @IsArray()
  @ArrayMaxSize(365)
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
export class ConfirmPdfDto extends VersionDto {
  @IsInt() @Min(1) inquiryVersion: number;
}
