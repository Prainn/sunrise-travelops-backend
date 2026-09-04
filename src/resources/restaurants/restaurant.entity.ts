import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  Unique,
} from 'typeorm';
import { SupplierEntity } from '../suppliers/supplier.entity';
import {
  TopLevelResourceEntity,
  VersionedResourceEntity,
} from '../common/resource.entity';

@Entity({ name: 'resource_restaurants' })
@Unique('UQ_resource_restaurants_code', ['code'])
@Check('CHK_resource_restaurants_status', `"status" IN ('enabled', 'disabled')`)
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
  @Column({ type: 'text', default: '' }) remark: string;
  @Column({ type: 'varchar', length: 100 }) unit: string;

  @OneToMany(() => RestaurantPriceEntity, (price) => price.restaurant)
  prices: RestaurantPriceEntity[];
}

@Entity({ name: 'resource_restaurant_prices' })
@Index('IDX_resource_restaurant_prices_restaurant', ['restaurantId'], {
  where: '"deleted_at" IS NULL',
})
@Index('IDX_resource_restaurant_prices_supplier', ['groundOperatorId'], {
  where: '"deleted_at" IS NULL AND "ground_operator_id" IS NOT NULL',
})
@Check('CHK_resource_restaurant_prices_price', '"price" >= 0')
@Check(
  'CHK_resource_restaurant_prices_diner_count',
  '"diner_count" IS NULL OR "diner_count" > 0',
)
@Check(
  'CHK_resource_restaurant_prices_supplier',
  '("is_ground_operator_provided" = false AND "ground_operator_id" IS NULL) OR ("is_ground_operator_provided" = true AND "ground_operator_id" IS NOT NULL)',
)
export class RestaurantPriceEntity extends VersionedResourceEntity {
  @Column({ name: 'restaurant_id', type: 'uuid' }) restaurantId: string;
  @ManyToOne(() => RestaurantEntity, (restaurant) => restaurant.prices, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'restaurant_id',
    foreignKeyConstraintName: 'FK_resource_restaurant_prices_restaurant',
  })
  restaurant: RestaurantEntity;
  @Column({ name: 'menu_name', type: 'varchar', length: 150 }) menuName: string;
  @Column({ name: 'dish_details', type: 'text', default: '' })
  dishDetails: string;
  @Column({ type: 'varchar', length: 100 }) unit: string;
  @Column({ type: 'numeric', precision: 12, scale: 2 }) price: string;
  @Column({ name: 'diner_count', type: 'integer', nullable: true }) dinerCount:
    number | null;
  @Column({ type: 'text', default: '' }) remark: string;
  @Column({
    name: 'is_ground_operator_provided',
    type: 'boolean',
    default: false,
  })
  isGroundOperatorProvided: boolean;
  @Column({ name: 'ground_operator_id', type: 'uuid', nullable: true })
  groundOperatorId: string | null;
  @ManyToOne(() => SupplierEntity, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({
    name: 'ground_operator_id',
    foreignKeyConstraintName: 'FK_resource_restaurant_prices_supplier',
  })
  groundOperator: SupplierEntity | null;
}
