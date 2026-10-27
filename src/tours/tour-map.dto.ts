import type { TourGuideService } from './tour-guide-services';
import { IsIn, IsISO8601, IsOptional, Matches } from 'class-validator';

export type MapBusinessUnit = 'shengxu' | 'linxi' | 'website';
export type MapRole = 'departure' | 'visit' | 'arrival' | 'overnight';
export type MapIssue =
  | 'manual_tour'
  | 'source_missing'
  | 'date_not_covered'
  | 'city_unlinked'
  | 'city_unmatched'
  | 'outside_yunnan'
  | 'coordinates_missing'
  | 'no_location';

export class TourMapQuery {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsISO8601({ strict: true })
  date?: string;
  @IsOptional()
  @IsIn(['shengxu', 'linxi', 'website'])
  businessUnit?: MapBusinessUnit;
}
export class MapStop {
  cityId: string | null;
  name: string;
  role: MapRole;
  longitude: number | null;
  latitude: number | null;
  issue: MapIssue | null;
}
export class MapDay {
  date: string;
  dayNumber: number;
  stops: MapStop[];
  overnightStatus: 'planned' | 'none' | 'unconfirmed';
  description: string;
  attractions: string[];
  meals: string[];
  transport: string[];
  hotelPlans: string[];
}
export class MapTour {
  id: string;
  tourNo: string;
  businessUnit: MapBusinessUnit;
  sourceModule: 'standard' | 'website' | 'manual';
  totalPeople: number;
  adults: number;
  children: number;
  leaders: number;
  guideServices: TourGuideService[];
  todayGuideServices: TourGuideService[];
  collectCoordinatorName: string;
  operatorName: string;
  pickupAt: string;
  dropAt: string;
  pickupFlight: Record<string, unknown> | null;
  dropFlight: Record<string, unknown> | null;
  days: number;
  dayNumber: number | null;
  located: boolean;
  issues: MapIssue[];
  today: MapDay | null;
  nextDay: MapDay | null;
  route: MapDay[];
}
export class MapCity {
  id: string;
  name: string;
  province: string;
  longitude: number | null;
  latitude: number | null;
  status: string;
  tourIds: string[];
  tourCount: number;
  peopleCount: number;
}
export class MapTotals {
  tours: number;
  people: number;
  located: number;
  unlocated: number;
}
export class TourMapResponse {
  date: string;
  timezone: string;
  coordinateSystem: string;
  businessUnit: MapBusinessUnit | null;
  canSelectBusinessUnit: boolean;
  totals: MapTotals;
  cities: MapCity[];
  tours: MapTour[];
  unlocatedTourIds: string[];
  pickupTourIds: string[];
  dropTourIds: string[];
}
