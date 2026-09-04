import { Check, Column, Entity, Index, Unique } from 'typeorm';
import { TopLevelResourceEntity } from '../common/resource.entity';

@Entity({ name: 'resource_transports' })
@Unique('UQ_resource_transports_code', ['code'])
@Check('CHK_resource_transports_status', `"status" IN ('enabled', 'disabled')`)
@Index('IDX_resource_transports_status_city_unit', ['status', 'city', 'unit'], {
  where: '"deleted_at" IS NULL',
})
@Check('CHK_resource_transports_seats', '"seats" > 0')
@Check('CHK_resource_transports_daily_price', '"daily_price" >= 0')
export class TransportEntity extends TopLevelResourceEntity {
  @Column({ name: 'plate_number', type: 'varchar', length: 50, default: '' })
  plateNumber: string;
  @Column({ type: 'integer' }) seats: number;
  @Column({ name: 'daily_price', type: 'numeric', precision: 12, scale: 2 })
  dailyPrice: string;
  @Column({ type: 'varchar', length: 100 }) unit: string;
  @Column({ type: 'varchar', length: 100, default: '' }) city: string;
  @Column({ type: 'varchar', length: 100, default: '' }) contact: string;
  @Column({ type: 'varchar', length: 50, default: '' }) phone: string;
  @Column({ type: 'text', default: '' }) remark: string;
}
