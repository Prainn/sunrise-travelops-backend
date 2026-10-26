import { Check, Column, Entity, Index, Unique } from 'typeorm';
import { TopLevelResourceEntity } from '../common/resource.entity';
@Entity({ name: 'resource_cities' })
@Unique('UQ_resource_cities_code', ['code'])
@Index('UQ_resource_cities_name', ['name'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
@Check('CHK_resource_cities_status', `"status" IN ('enabled', 'disabled')`)
@Check(
  'CHK_resource_cities_coordinates',
  `(longitude IS NULL AND latitude IS NULL) OR (longitude IS NOT NULL AND latitude IS NOT NULL AND longitude BETWEEN -180 AND 180 AND latitude BETWEEN -90 AND 90)`,
)
export class CityEntity extends TopLevelResourceEntity {
  @Column({ type: 'varchar', length: 100, default: '' })
  province: string;

  @Column({ type: 'double precision', nullable: true })
  longitude: number | null;

  @Column({ type: 'double precision', nullable: true })
  latitude: number | null;
}
