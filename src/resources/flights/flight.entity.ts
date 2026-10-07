import { Check, Column, Entity, Index } from 'typeorm';
import { ResourceStatus } from '../common/resource.constants';
import { VersionedResourceEntity } from '../common/resource.entity';

@Entity({ name: 'resource_flights' })
@Index('IDX_resource_flights_library_status', ['library', 'status'], {
  where: '"deleted_at" IS NULL',
})
@Index(
  'UQ_resource_flights_schedule',
  [
    'library',
    'departureCity',
    'arrivalCity',
    'flightNumber',
    'departureTime',
    'arrivalTime',
  ],
  { unique: true, where: '"deleted_at" IS NULL' },
)
@Check('CHK_resource_flights_status', `"status" IN ('enabled','disabled')`)
@Check(
  'CHK_resource_flights_cities',
  `length(btrim("departure_city")) > 0 AND length(btrim("arrival_city")) > 0`,
)
@Check('CHK_resource_flights_number', `"flight_number" ~ '^[A-Z0-9]{1,20}$'`)
@Check(
  'CHK_resource_flights_times',
  `"departure_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "arrival_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`,
)
export class FlightEntity extends VersionedResourceEntity {
  @Column({ type: 'text' }) library: 'shengxu' | 'shared';
  @Column({ name: 'departure_city', type: 'varchar', length: 150 })
  departureCity: string;
  @Column({ name: 'arrival_city', type: 'varchar', length: 150 })
  arrivalCity: string;
  @Column({ name: 'flight_number', type: 'varchar', length: 20 })
  flightNumber: string;
  @Column({ name: 'departure_time', type: 'varchar', length: 5 })
  departureTime: string;
  @Column({ name: 'arrival_time', type: 'varchar', length: 5 })
  arrivalTime: string;
  @Column({ type: 'varchar', length: 20, default: ResourceStatus.Enabled })
  status: ResourceStatus;
}
