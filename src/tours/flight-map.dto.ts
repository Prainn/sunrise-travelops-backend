import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsOptional, Matches } from 'class-validator';
import { MapBusinessUnit } from './tour-map.dto';

export class FlightMapQuery {
  @ApiPropertyOptional({ example: '2026-10-27', description: '默认上海当天' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsISO8601({ strict: true })
  date?: string;

  @ApiPropertyOptional({ enum: ['shengxu', 'linxi', 'website'] })
  @IsOptional()
  @IsIn(['shengxu', 'linxi', 'website'])
  businessUnit?: MapBusinessUnit;
}

export type FlightMapIssue =
  'flight_missing' | 'airport_missing' | 'coordinates_missing';

export class FlightMapAirport {
  @ApiProperty({ type: String, nullable: true }) code: string | null;
  @ApiProperty({ type: String, nullable: true }) name: string | null;
  @ApiProperty({ type: String, nullable: true }) englishName: string | null;
  @ApiProperty({ type: Number, nullable: true }) longitude: number | null;
  @ApiProperty({ type: Number, nullable: true }) latitude: number | null;
}

export class FlightMapTour {
  @ApiProperty() id: string;
  @ApiProperty() tourNo: string;
  @ApiProperty({ enum: ['shengxu', 'linxi', 'website'] })
  businessUnit: MapBusinessUnit;
  @ApiProperty({ enum: ['standard', 'website', 'manual'] })
  sourceModule: 'standard' | 'website' | 'manual';
  @ApiProperty() totalPeople: number;
}

export class FlightMapLeg {
  @ApiProperty({ description: '稳定标识：tourId:pickup 或 tourId:drop' })
  id: string;
  @ApiProperty({ enum: ['pickup', 'drop'] }) kind: 'pickup' | 'drop';
  @ApiProperty({ enum: ['arrival', 'departure'] })
  referenceEvent: 'arrival' | 'departure';
  @ApiProperty({
    description:
      '成团排期参考时刻 YYYY-MM-DD HH:mm，不是机场当地时间或实时航班时间',
  })
  scheduledAt: string;
  @ApiProperty({ type: String, nullable: true }) flightNumber: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: '快照原始 HH:mm，不推断时区或跨日',
  })
  departureTime: string | null;
  @ApiProperty({ type: String, nullable: true }) arrivalTime: string | null;
  @ApiProperty({ type: FlightMapAirport }) departureAirport: FlightMapAirport;
  @ApiProperty({ type: FlightMapAirport }) arrivalAirport: FlightMapAirport;
  @ApiProperty() located: boolean;
  @ApiProperty({
    enum: ['flight_missing', 'airport_missing', 'coordinates_missing'],
    isArray: true,
  })
  issues: FlightMapIssue[];
  @ApiProperty({ type: FlightMapTour }) tour: FlightMapTour;
}

export class FlightMapTotals {
  @ApiProperty() tours: number;
  @ApiProperty() people: number;
  @ApiProperty() flightLegs: number;
  @ApiProperty() pickupLegs: number;
  @ApiProperty() dropLegs: number;
  @ApiProperty() locatedLegs: number;
  @ApiProperty() unlocatedLegs: number;
  @ApiProperty() unscheduledTours: number;
}

export class FlightMapResponse {
  @ApiProperty() date: string;
  @ApiProperty({ enum: ['Asia/Shanghai'] }) timezone: 'Asia/Shanghai';
  @ApiProperty({ enum: ['WGS84'] }) coordinateSystem: 'WGS84';
  @ApiProperty({ enum: ['route_demo'] }) animationMode: 'route_demo';
  @ApiProperty({ enum: ['shengxu', 'linxi', 'website'], nullable: true })
  businessUnit: MapBusinessUnit | null;
  @ApiProperty() canSelectBusinessUnit: boolean;
  @ApiProperty({ type: FlightMapTotals }) totals: FlightMapTotals;
  @ApiProperty({ type: [FlightMapLeg] }) flights: FlightMapLeg[];
  @ApiProperty({ type: [String] }) unlocatedFlightIds: string[];
  @ApiProperty({
    type: [FlightMapTour],
    description: '当天接/送团但为手填时间模式，无航班可绘制；按团去重',
  })
  unscheduledTours: FlightMapTour[];
}
