import { Check, Column, Entity, Index, Unique } from 'typeorm';
import { TopLevelResourceEntity } from '../common/resource.entity';

@Entity({ name: 'resource_hotels' })
@Unique('UQ_resource_hotels_code', ['code'])
@Check('CHK_resource_hotels_status', `"status" IN ('enabled', 'disabled')`)
@Check('CHK_resource_hotels_rating', '"rating" IN (3, 4, 5)')
@Index('IDX_resource_hotels_status_city_unit', ['status', 'city', 'unit'], {
  where: '"deleted_at" IS NULL',
})
@Check('CHK_resource_hotels_individual_price', '"individual_price" >= 0')
@Check(
  'CHK_resource_hotels_group_price',
  '"group_price" IS NULL OR "group_price" >= 0',
)
@Check(
  'CHK_resource_hotels_minimum_group_size',
  '"minimum_group_size" IS NULL OR "minimum_group_size" > 0',
)
export class HotelEntity extends TopLevelResourceEntity {
  @Column({ name: 'english_name', type: 'varchar', length: 150, default: '' })
  englishName: string;
  @Column({ type: 'varchar', length: 100, default: '' })
  province: string;

  @Column({ type: 'varchar', length: 100, default: '' })
  city: string;

  @Column({ type: 'smallint' })
  rating: number;

  @Column({ type: 'text', default: '' })
  facilities: string;

  @Column({ type: 'text', default: '' })
  breakfast: string;

  @Column({ type: 'varchar', length: 500, default: '' })
  address: string;

  @Column({ type: 'varchar', length: 50, default: '' })
  phone: string;

  @Column({ type: 'text', default: '' })
  nearby: string;

  @Column({
    name: 'individual_price',
    type: 'numeric',
    precision: 12,
    scale: 2,
  })
  individualPrice: string;

  @Column({
    name: 'group_price',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  groupPrice: string | null;

  @Column({ name: 'minimum_group_size', type: 'integer', nullable: true })
  minimumGroupSize: number | null;

  @Column({ type: 'varchar', length: 100 })
  unit: string;
}
