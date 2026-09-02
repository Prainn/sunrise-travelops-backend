import { AuditedEntity } from '../../common/entities/audited.entity';
import {
  Check,
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  Unique,
  VersionColumn,
} from 'typeorm';
import {
  BusinessDictionaryStatus,
  BusinessResourceType,
} from './business-dictionary-status';
import { BusinessDictionaryTypeEntity } from './business-dictionary-type.entity';

@Entity({ name: 'system_business_dictionary_items' })
@Unique('UQ_system_business_dictionary_items_type_code', ['typeId', 'code'])
@Index(
  'IDX_system_business_dictionary_items_type_status',
  ['typeId', 'status'],
  {
    where: '"deleted_at" IS NULL',
  },
)
@Check(
  'CHK_system_business_dictionary_items_status',
  `"status" IN ('enabled', 'disabled')`,
)
export class BusinessDictionaryItemEntity extends AuditedEntity {
  @Column({ name: 'type_id', type: 'uuid' })
  typeId: string;

  @ManyToOne(() => BusinessDictionaryTypeEntity, (type) => type.items, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'type_id',
    foreignKeyConstraintName: 'FK_system_business_dictionary_items_type',
  })
  dictionaryType: BusinessDictionaryTypeEntity;

  @Column({ type: 'varchar', length: 100 })
  code: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ name: 'english_name', type: 'varchar', length: 150 })
  englishName: string;

  @Column({
    name: 'resource_types',
    type: 'text',
    array: true,
    default: () => `'{}'`,
  })
  resourceTypes: BusinessResourceType[];

  @Column({
    type: 'varchar',
    length: 20,
    default: BusinessDictionaryStatus.Enabled,
  })
  status: BusinessDictionaryStatus;

  @Column({ type: 'text', default: '' })
  remark: string;

  @VersionColumn({ type: 'integer', default: 1 })
  version: number;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;
}
