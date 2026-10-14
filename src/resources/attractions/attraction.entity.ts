import { Check, Column, Entity, Index, Unique } from 'typeorm';
import { TopLevelResourceEntity } from '../common/resource.entity';
import { AttractionCategory } from '../common/resource.constants';

/** One record is one attraction or chargeable item with a single settlement price. */
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
@Check('CHK_resource_attractions_price', '"price" IS NULL OR "price" >= 0')
export class AttractionEntity extends TopLevelResourceEntity {
  @Column({ type: 'varchar', length: 100, default: '' }) area: string;
  @Column({ type: 'varchar', length: 20, nullable: true })
  category: AttractionCategory | null;
  @Column({
    name: 'restroom_location',
    type: 'varchar',
    length: 500,
    default: '',
  })
  restroomLocation: string;
  @Column({ name: 'is_standard_price', type: 'boolean', default: false })
  isStandardPrice: boolean;
  @Column({ type: 'text', default: '' }) description: string;
  @Column({ type: 'text', default: '' }) remark: string;
  @Column({ type: 'varchar', length: 100 }) unit: string;
  /** Settlement price; null only for migrated legacy records still waiting for a price. */
  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  price: string | null;
}
