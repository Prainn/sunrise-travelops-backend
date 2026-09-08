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
import {
  TopLevelResourceEntity,
  VersionedResourceEntity,
} from '../common/resource.entity';
import {
  AttractionCategory,
  AttractionPriceItemType,
} from '../common/resource.constants';

@Entity({ name: 'resource_attractions' })
@Unique('UQ_resource_attractions_code', ['code'])
@Check('CHK_resource_attractions_status', `"status" IN ('enabled', 'disabled')`)
@Index(
  'IDX_resource_attractions_status_area_category_unit',
  ['status', 'area', 'category', 'unit'],
  { where: '"deleted_at" IS NULL' },
)
@Check(
  'CHK_resource_attractions_category',
  "\"category\" IN ('scenic', 'performance', 'experience', 'transport', 'package')",
)
export class AttractionEntity extends TopLevelResourceEntity {
  @Column({ type: 'varchar', length: 100, default: '' }) area: string;
  @Column({ type: 'varchar', length: 20 }) category: AttractionCategory;
  @Column({
    name: 'restroom_location',
    type: 'varchar',
    length: 500,
    default: '',
  })
  restroomLocation: string;
  @Column({ type: 'text', default: '' }) remark: string;
  @Column({ type: 'varchar', length: 100 }) unit: string;
  @OneToMany(() => AttractionPriceEntity, (price) => price.attraction)
  prices: AttractionPriceEntity[];
}

@Entity({ name: 'resource_attraction_prices' })
@Index('IDX_resource_attraction_prices_attraction', ['attractionId'], {
  where: '"deleted_at" IS NULL',
})
@Check(
  'CHK_resource_attraction_prices_item_type',
  "\"item_type\" IN ('ticket', 'transport', 'guide', 'activity', 'package')",
)
@Check(
  'CHK_resource_attraction_prices_dates',
  '"start_date" IS NULL OR "end_date" IS NULL OR "start_date" <= "end_date"',
)
@Check(
  'CHK_resource_attraction_prices_amounts',
  '"rack_price" >= 0 AND "settlement_price" >= 0',
)
@Check(
  'CHK_resource_attraction_prices_free',
  '"is_free" = false OR ("rack_price" = 0 AND "settlement_price" = 0)',
)
export class AttractionPriceEntity extends VersionedResourceEntity {
  @Column({ name: 'attraction_id', type: 'uuid' }) attractionId: string;
  @ManyToOne(() => AttractionEntity, (attraction) => attraction.prices, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'attraction_id',
    foreignKeyConstraintName: 'FK_resource_attraction_prices_attraction',
  })
  attraction: AttractionEntity;
  @Column({ name: 'item_type', type: 'varchar', length: 20 })
  itemType: AttractionPriceItemType;
  @Column({ name: 'item_name', type: 'varchar', length: 150 }) itemName: string;
  @Column({ type: 'varchar', length: 100, default: '' }) audience: string;
  @Column({ name: 'period_name', type: 'varchar', length: 100, default: '' })
  periodName: string;
  @Column({ name: 'start_date', type: 'date', nullable: true }) startDate:
    string | null;
  @Column({ name: 'end_date', type: 'date', nullable: true }) endDate:
    string | null;
  @Column({ name: 'rack_price', type: 'numeric', precision: 12, scale: 2 })
  rackPrice: string;
  @Column({
    name: 'settlement_price',
    type: 'numeric',
    precision: 12,
    scale: 2,
  })
  settlementPrice: string;
  @Column({ type: 'varchar', length: 100 }) unit: string;
  @Column({ name: 'is_free', type: 'boolean', default: false }) isFree: boolean;
  @Column({ name: 'price_note', type: 'text', default: '' }) priceNote: string;
}
