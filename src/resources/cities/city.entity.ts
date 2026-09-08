import { Check, Column, Entity, Unique } from 'typeorm';
import { TopLevelResourceEntity } from '../common/resource.entity';
@Entity({ name: 'resource_cities' })
@Unique('UQ_resource_cities_code', ['code'])
@Unique('UQ_resource_cities_name', ['name'])
@Check('CHK_resource_cities_status', `"status" IN ('enabled', 'disabled')`)
export class CityEntity extends TopLevelResourceEntity {
  @Column({ type: 'varchar', length: 100, default: '' })
  province: string;
}
