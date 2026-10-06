import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import type {
  FeeState,
  TransportMode,
  VehicleType,
  ConfigStatus,
  WebsiteInquiryInput,
  WebsiteItineraryInput,
  WebsiteConfig,
  WebsiteDay,
  WebsiteItem,
  WebsiteLeg,
  WebsiteHotelStay,
  WebsiteMeal,
  WebsiteService,
  WebsiteVehiclePrice,
  WebsiteCity,
  WebsiteAttraction,
  WebsiteRoute,
  WebsitePattern,
  WebsiteSkeleton,
  WebsiteTemplate,
} from './website.types';

const fees: FeeState[] = [
  'INCLUDED',
  'EXCLUDED',
  'OPTIONAL',
  'RECOMMENDED',
  'ARRANGED',
  'SELF_PAY',
  'UNKNOWN',
];
const modes: TransportMode[] = ['hsr', 'private_vehicle', 'flight', 'other'];
const vehicles: VehicleType[] = [
  '5_seat',
  '7_seat',
  '9_seat',
  '14_seat',
  '18_seat',
];
const statuses = ['new', 'planning', 'quoted', 'lost', 'archived'] as const;
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class WebsiteVersionDto {
  @IsInt() @Min(1) version: number;
}
export class WebsiteInquiryDto implements WebsiteInquiryInput {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  customerName: string;
  @IsInt() @Min(1) @Max(365) plannedDays: number;
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200000)
  requirements: string;
  @IsOptional() @IsUUID() ownerId?: string;
  @IsString() @MaxLength(50) phone = '';
  @IsString() @MaxLength(254) email = '';
  @IsDefined()
  @ValidateIf((o: WebsiteInquiryDto) => o.startDate !== null)
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @MaxLength(10)
  startDate: string | null = null;
  @IsDefined()
  @ValidateIf((o: WebsiteInquiryDto) => o.pax !== null)
  @IsInt()
  @Min(1)
  @Max(10000)
  pax: number | null = null;
  @IsString() @MaxLength(100) arrivalTime = '';
  @IsString() @MaxLength(100) departureTime = '';
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(365)
  @IsUUID(undefined, { each: true })
  destinations: string[] = [];
  @IsString() @MaxLength(20000) internalRemark = '';
  @IsOptional() @IsIn(statuses) status?: WebsiteInquiryInput['status'];
  @IsString() @MaxLength(2000) lostReason = '';
}
export class WebsiteUpdateInquiryDto extends WebsiteInquiryDto {
  @IsInt() @Min(1) version: number;
}
export class WebsiteTransferDto extends WebsiteVersionDto {
  @IsUUID() ownerId: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(2000) reason: string;
}
export class WebsiteInquiryQuery extends PaginationQueryDto {
  @IsOptional() @IsString() @MaxLength(100) keyword: string | undefined =
    undefined;
  @IsOptional() @IsIn(statuses) status?: WebsiteInquiryInput['status'];
  @IsOptional() @IsUUID() ownerId?: string;
}
export class WebsiteResourceQuery extends PaginationQueryDto {
  @IsOptional() @IsString() @MaxLength(100) keyword: string | undefined =
    undefined;
}
export class WebsiteConfigQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) version?: number;
}
export class WebsiteItemDto implements WebsiteItem {
  @IsUUID() id: string;
  @IsDefined()
  @ValidateIf((o: WebsiteItemDto) => o.attractionId !== null)
  @IsUUID()
  attractionId: string | null;
  @IsString() @MaxLength(150) nameZh: string;
  @IsString() @MaxLength(150) nameEn: string;
  @IsString() @MaxLength(20000) descriptionZh: string;
  @IsString() @MaxLength(20000) descriptionEn: string;
  @IsBoolean() appears: boolean;
  @IsIn(fees) feeState: FeeState;
}
export class WebsiteLegDto implements WebsiteLeg {
  @IsUUID() id: string;
  @IsDefined()
  @ValidateIf((o: WebsiteLegDto) => o.routeId !== null)
  @IsUUID()
  routeId: string | null;
  @IsUUID() fromCityId: string;
  @IsUUID() toCityId: string;
  @IsIn(modes) mode: TransportMode;
  @IsString() @MaxLength(150) nameZh: string;
  @IsString() @MaxLength(150) nameEn: string;
  @IsIn(fees) feeState: FeeState;
}
export class WebsiteHotelDto implements WebsiteHotelStay {
  @IsUUID() id: string;
  @IsIn(['A', 'B']) tier: 'A' | 'B';
  @IsUUID() cityId: string;
  @IsDefined()
  @ValidateIf((o: WebsiteHotelDto) => o.resourceId !== null)
  @IsUUID()
  resourceId: string | null;
  @IsString() @MaxLength(150) nameZh: string;
  @IsString() @MaxLength(150) nameEn: string;
  @IsString() @MaxLength(200) roomType: string;
  @IsBoolean() breakfastIncluded: boolean;
}
export class WebsiteMealDto implements WebsiteMeal {
  @IsUUID() id: string;
  @IsIn(['breakfast', 'lunch', 'dinner']) slot:
    'breakfast' | 'lunch' | 'dinner';
  @IsDefined()
  @ValidateIf((o: WebsiteMealDto) => o.resourceId !== null)
  @IsUUID()
  resourceId: string | null;
  @IsString() @MaxLength(150) restaurantZh: string;
  @IsString() @MaxLength(150) restaurantEn: string;
  @IsIn(fees) feeState: FeeState;
}
export class WebsiteServiceDto implements WebsiteService {
  @IsUUID() id: string;
  @IsString() @MaxLength(150) nameZh: string;
  @IsString() @MaxLength(150) nameEn: string;
  @IsBoolean() appears: boolean;
  @IsIn(fees) feeState: FeeState;
}
export class WebsiteDayDto implements WebsiteDay {
  @IsUUID() id: string;
  @IsInt() @Min(1) @Max(365) dayNumber: number;
  @IsUUID() departCityId: string;
  @IsUUID() endCityId: string;
  @IsDefined()
  @ValidateIf((o: WebsiteDayDto) => o.overnightCityId !== null)
  @IsUUID()
  overnightCityId: string | null;
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => WebsiteItemDto)
  items: WebsiteItemDto[];
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => WebsiteLegDto)
  legs: WebsiteLegDto[];
  @IsArray()
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => WebsiteHotelDto)
  hotels: WebsiteHotelDto[];
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => WebsiteMealDto)
  meals: WebsiteMealDto[];
  @IsString() @MaxLength(100) guideLanguage: string;
  @IsString() @MaxLength(1000) guideScope: string;
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => WebsiteServiceDto)
  services: WebsiteServiceDto[];
}
export class WebsiteVehiclePriceDto implements WebsiteVehiclePrice {
  @IsIn(vehicles) vehicleType: VehicleType;
  @IsDefined()
  @ValidateIf((o: WebsiteVehiclePriceDto) => o.unitPrice !== null)
  @IsString()
  @Matches(/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/)
  unitPrice: string | null;
}
export class WebsiteItineraryDto implements WebsiteItineraryInput {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(150) title: string;
  @IsInt() @Min(1) @Max(365) duration: number;
  @IsDefined()
  @ValidateIf((o: WebsiteItineraryDto) => o.startDate !== null)
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @MaxLength(10)
  startDate: string | null = null;
  @IsDefined()
  @ValidateIf((o: WebsiteItineraryDto) => o.pax !== null)
  @IsInt()
  @Min(1)
  @Max(10000)
  pax: number | null = null;
  @IsString() @MaxLength(100) arrivalTime = '';
  @IsString() @MaxLength(100) departureTime = '';
  @IsInt() @Min(0) configVersion: number;
  @IsArray()
  @ArrayMaxSize(365)
  @ValidateNested({ each: true })
  @Type(() => WebsiteDayDto)
  days: WebsiteDayDto[] = [];
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => WebsiteVehiclePriceDto)
  vehiclePrices: WebsiteVehiclePriceDto[] = [];
}
export class WebsiteUpdateItineraryDto extends WebsiteItineraryDto {
  @IsInt() @Min(1) version: number;
}
export class WebsiteCreateItineraryDto extends WebsiteItineraryDto {
  @IsInt() @Min(1) inquiryVersion: number;
}
export class WebsiteGenerateDto extends WebsiteVersionDto {
  @IsUUID() skeletonId: string;
}
export class WebsiteConfirmDto extends WebsiteVersionDto {
  @IsInt() @Min(1) inquiryVersion: number;
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  acknowledgedWarnings: string[];
}
class ConfigBaseDto {
  @IsUUID() id: string;
  @IsIn(['enabled', 'disabled']) status: ConfigStatus;
}
export class WebsiteCityDto extends ConfigBaseDto implements WebsiteCity {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(150) nameZh: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(150) nameEn: string;
  @IsDefined()
  @ValidateIf((o: WebsiteCityDto) => o.resourceId !== null)
  @IsUUID()
  resourceId: string | null;
}
export class WebsiteAttractionDto
  extends ConfigBaseDto
  implements WebsiteAttraction
{
  @IsUUID() cityId: string;
  @IsDefined()
  @ValidateIf((o: WebsiteAttractionDto) => o.parentId !== null)
  @IsUUID()
  parentId: string | null;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(150) nameZh: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(150) nameEn: string;
  @IsDefined()
  @ValidateIf((o: WebsiteAttractionDto) => o.resourceId !== null)
  @IsUUID()
  resourceId: string | null;
  @IsIn(['attraction', 'component']) kind: 'attraction' | 'component';
  @IsBoolean() chargeable: boolean;
  @IsString() @MinLength(1) @MaxLength(100) copyKey: string;
  @IsArray()
  @ArrayMaxSize(12)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(12, { each: true })
  recommendedMonths: number[];
}
export class WebsiteRouteDto extends ConfigBaseDto implements WebsiteRoute {
  @IsUUID() fromCityId: string;
  @IsUUID() toCityId: string;
  @IsIn(modes) mode: TransportMode;
  @IsString() @MinLength(1) @MaxLength(150) nameZh: string;
  @IsString() @MinLength(1) @MaxLength(150) nameEn: string;
  @IsIn(fees) feeState: FeeState;
}
export class WebsitePatternDto extends ConfigBaseDto implements WebsitePattern {
  @IsUUID() cityId: string;
  @IsString() @MinLength(1) @MaxLength(150) nameZh: string;
  @IsString() @MinLength(1) @MaxLength(150) nameEn: string;
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(200)
  @IsUUID(undefined, { each: true })
  attractionIds: string[];
}
export class WebsiteSkeletonDayDto {
  @IsUUID() cityId: string;
  @IsDefined()
  @ValidateIf((o: WebsiteSkeletonDayDto) => o.patternId !== null)
  @IsUUID()
  patternId: string | null;
}
export class WebsiteSkeletonDto
  extends ConfigBaseDto
  implements WebsiteSkeleton
{
  @IsString() @MinLength(1) @MaxLength(150) nameZh: string;
  @IsString() @MinLength(1) @MaxLength(150) nameEn: string;
  @IsArray()
  @ArrayMaxSize(365)
  @ValidateNested({ each: true })
  @Type(() => WebsiteSkeletonDayDto)
  days: WebsiteSkeletonDayDto[];
}
export class WebsiteTemplateDto
  extends ConfigBaseDto
  implements WebsiteTemplate
{
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(150) name: string;
  @IsString() @MinLength(1) @MaxLength(100) code: string;
  @IsString() @MinLength(1) @MaxLength(20000) zh: string;
  @IsString() @MinLength(1) @MaxLength(20000) en: string;
}
export class WebsiteConfigDto implements WebsiteConfig {
  @IsInt() @Min(0) version: number;
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => WebsiteCityDto)
  cities: WebsiteCityDto[];
  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => WebsiteAttractionDto)
  attractions: WebsiteAttractionDto[];
  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => WebsiteRouteDto)
  routes: WebsiteRouteDto[];
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => WebsitePatternDto)
  patterns: WebsitePatternDto[];
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => WebsiteSkeletonDto)
  skeletons: WebsiteSkeletonDto[];
  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => WebsiteTemplateDto)
  templates: WebsiteTemplateDto[];
}
