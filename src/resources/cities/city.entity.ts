import { Check, Column, Entity, Index, Unique } from 'typeorm';
import { TopLevelResourceEntity } from '../common/resource.entity';
@Entity({ name: 'resource_cities' })
@Unique('UQ_resource_cities_code', ['code'])
@Index('UQ_resource_cities_name', ['name'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
@Check('CHK_resource_cities_status', `"status" IN ('enabled', 'disabled')`)
export class CityEntity extends TopLevelResourceEntity {
  @Column({ type: 'varchar', length: 100, default: '' })
  province: string;
}
