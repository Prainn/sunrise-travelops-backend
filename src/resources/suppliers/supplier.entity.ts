import { Check, Column, Entity, Index, Unique } from 'typeorm';
import { TopLevelResourceEntity } from '../common/resource.entity';

@Entity({ name: 'resource_suppliers' })
@Unique('UQ_resource_suppliers_code', ['code'])
@Check('CHK_resource_suppliers_status', `"status" IN ('enabled', 'disabled')`)
@Index('IDX_resource_suppliers_status', ['status'], {
  where: '"deleted_at" IS NULL',
})
export class SupplierEntity extends TopLevelResourceEntity {
  @Column({ type: 'varchar', length: 100, default: '' })
  city: string;

  @Column({
    name: 'country_or_region',
    type: 'varchar',
    length: 100,
    default: '',
  })
  countryOrRegion: string;

  @Column({ type: 'varchar', length: 100, default: '' })
  contact: string;

  @Column({ type: 'varchar', length: 254, default: '' })
  email: string;

  @Column({ type: 'varchar', length: 50, default: '' })
  phone: string;

  @Column({ type: 'text', default: '' })
  remark: string;
}
