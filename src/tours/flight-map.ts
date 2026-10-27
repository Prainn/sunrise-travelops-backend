import { AIRPORT_COORDINATES } from './airport-coordinates';
import {
  FlightMapAirport,
  FlightMapIssue,
  FlightMapLeg,
  FlightMapResponse,
  FlightMapTour,
} from './flight-map.dto';
import { MapBusinessUnit } from './tour-map.dto';

interface AirportSnapshot {
  code: string;
  name: string;
  englishName: string;
}

interface FlightSnapshot {
  flightNumber: string;
  departureTime: string;
  arrivalTime: string;
  departureAirport: AirportSnapshot | null;
  arrivalAirport: AirportSnapshot | null;
}

export interface FlightMapRow extends FlightMapTour {
  scheduleMode: 'flight' | 'manual';
  kind: 'pickup' | 'drop';
  scheduledAt: string;
  flight: FlightSnapshot | null;
}

function airport(
  snapshot: AirportSnapshot | null | undefined,
): FlightMapAirport {
  const coordinates = snapshot?.code
    ? AIRPORT_COORDINATES[snapshot.code]
    : undefined;
  return {
    code: snapshot?.code ?? null,
    name: snapshot?.name ?? null,
    englishName: snapshot?.englishName ?? null,
    longitude: coordinates?.[0] ?? null,
    latitude: coordinates?.[1] ?? null,
  };
}

/** Only authorized, date-filtered rows enter this projection. No resource repricing or live flight lookup. */
export function buildFlightMap(
  date: string,
  businessUnit: MapBusinessUnit | null,
  canSelectBusinessUnit: boolean,
  rows: FlightMapRow[],
): FlightMapResponse {
  const tours = new Map<string, FlightMapTour>();
  const unscheduled = new Map<string, FlightMapTour>();
  const flights: FlightMapLeg[] = [];
  for (const row of rows) {
    const tour: FlightMapTour = {
      id: row.id,
      tourNo: row.tourNo,
      businessUnit: row.businessUnit,
      sourceModule: row.sourceModule,
      totalPeople: row.totalPeople,
    };
    tours.set(tour.id, tour);
    if (row.scheduleMode === 'manual') {
      unscheduled.set(tour.id, tour);
      continue;
    }
    const departureAirport = airport(row.flight?.departureAirport);
    const arrivalAirport = airport(row.flight?.arrivalAirport);
    const issues: FlightMapIssue[] = [];
    if (!row.flight) issues.push('flight_missing');
    else if (!departureAirport.code || !arrivalAirport.code)
      issues.push('airport_missing');
    else if (
      departureAirport.longitude === null ||
      arrivalAirport.longitude === null
    )
      issues.push('coordinates_missing');
    flights.push({
      id: `${tour.id}:${row.kind}`,
      kind: row.kind,
      referenceEvent: row.kind === 'pickup' ? 'arrival' : 'departure',
      scheduledAt: row.scheduledAt,
      flightNumber: row.flight?.flightNumber ?? null,
      departureTime: row.flight?.departureTime ?? null,
      arrivalTime: row.flight?.arrivalTime ?? null,
      departureAirport,
      arrivalAirport,
      located: issues.length === 0,
      issues,
      tour,
    });
  }
  const unlocatedFlightIds = flights
    .filter((leg) => !leg.located)
    .map((leg) => leg.id);
  return {
    date,
    timezone: 'Asia/Shanghai',
    coordinateSystem: 'WGS84',
    animationMode: 'route_demo',
    businessUnit,
    canSelectBusinessUnit,
    totals: {
      tours: tours.size,
      people: [...tours.values()].reduce(
        (sum, tour) => sum + tour.totalPeople,
        0,
      ),
      flightLegs: flights.length,
      pickupLegs: flights.filter((leg) => leg.kind === 'pickup').length,
      dropLegs: flights.filter((leg) => leg.kind === 'drop').length,
      locatedLegs: flights.length - unlocatedFlightIds.length,
      unlocatedLegs: unlocatedFlightIds.length,
      unscheduledTours: unscheduled.size,
    },
    flights,
    unlocatedFlightIds,
    unscheduledTours: [...unscheduled.values()],
  };
}
