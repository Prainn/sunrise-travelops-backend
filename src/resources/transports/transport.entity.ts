import { Check, Column, Entity, Unique } from 'typeorm';
import { TopLevelResourceEntity } from '../common/resource.entity';

@Entity({ name: 'resource_transports' })
@Unique('UQ_resource_transports_code', ['code'])
@Check('CHK_resource_transports_status', `"status" IN ('enabled', 'disabled')`)
@Check(
  'CHK_resource_transports_service_level',
  `"service_level" IN ('standard', 'vip')`,
)
@Check('CHK_resource_transports_seats', '"seats" > 0')
export class TransportEntity extends TopLevelResourceEntity {
  @Column({ name: 'service_level', type: 'varchar', length: 20 })
  serviceLevel: string;
  @Column({ type: 'integer' }) seats: number;
  @Column({ type: 'varchar', length: 100 }) unit: string;
  @Column({ type: 'varchar', length: 50, default: '' }) phone: string;
  @Column({ type: 'text', default: '' }) remark: string;
}
