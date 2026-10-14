import { Check, Column, Entity, Index, Unique } from 'typeorm';
import { TopLevelResourceEntity } from '../common/resource.entity';

/** One record is one restaurant package/price; several may be standard-price in a city. */
@Entity({ name: 'resource_restaurants' })
@Unique('UQ_resource_restaurants_code', ['code'])
@Check('CHK_resource_restaurants_status', `"status" IN ('enabled', 'disabled')`)
@Check('CHK_resource_restaurants_price', '"price" IS NULL OR "price" >= 0')
@Check(
  'CHK_resource_restaurants_diner_count',
  '"diner_count" IS NULL OR "diner_count" > 0',
)
@Index(
  'IDX_resource_restaurants_status_city_unit',
  ['status', 'city', 'unit'],
  {
    where: '"deleted_at" IS NULL',
  },
)
export class RestaurantEntity extends TopLevelResourceEntity {
  @Column({ type: 'varchar', length: 100, default: '' }) city: string;
  @Column({ type: 'varchar', length: 100, default: '' }) cuisine: string;
  @Column({ type: 'varchar', length: 100, default: '' }) contact: string;
  @Column({ type: 'varchar', length: 50, default: '' }) phone: string;
  @Column({ type: 'varchar', length: 500, default: '' }) address: string;
  @Column({ name: 'is_standard_price', type: 'boolean', default: false })
  isStandardPrice: boolean;
  @Column({ type: 'text', default: '' }) description: string;
  @Column({ type: 'text', default: '' }) remark: string;
  /** personMeal (default) or table. */
  @Column({ type: 'varchar', length: 100 }) unit: string;
  /** Price per person-meal or per table; null only for legacy records awaiting a price. */
  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  price: string | null;
  /** Required positive integer only when the unit is per table. */
  @Column({ name: 'diner_count', type: 'integer', nullable: true })
  dinerCount: number | null;
}
