import { AuditedEntity } from '../../common/entities/audited.entity';
import {
  Column,
  Check,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  Unique,
  VersionColumn,
} from 'typeorm';
import { DictionaryStatus, DictionaryTagType } from './dictionary-status';
import { DictionaryTypeEntity } from './dictionary-type.entity';

@Entity({ name: 'system_dictionary_items' })
@Unique('UQ_system_dictionary_items_type_value', ['typeId', 'value'])
@Index(
  'IDX_system_dictionary_items_type_status_sort',
  ['typeId', 'status', 'sort'],
  { where: '"deleted_at" IS NULL' },
)
@Check('CHK_system_dictionary_items_status', '"status" IN (0, 1)')
@Check(
  'CHK_system_dictionary_items_tag_type',
  `"tag_type" IN ('', 'primary', 'success', 'info', 'warning', 'danger')`,
)
export class DictionaryItemEntity extends AuditedEntity {
  @Column({ name: 'type_id', type: 'uuid' })
  typeId: string;

  @ManyToOne(() => DictionaryTypeEntity, (type) => type.items, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'type_id',
    foreignKeyConstraintName: 'FK_system_dictionary_items_type',
  })
  dictionaryType: DictionaryTypeEntity;

  @Column({ type: 'varchar', length: 100 })
  label: string;

  @Column({ type: 'varchar', length: 100 })
  value: string;

  @Column({ type: 'smallint', default: DictionaryStatus.Enabled })
  status: DictionaryStatus;

  @Column({ type: 'integer', default: 1 })
  sort: number;

  @Column({ name: 'tag_type', type: 'varchar', length: 20, default: '' })
  tagType: DictionaryTagType;

  @VersionColumn({ type: 'integer', default: 1 })
  version: number;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;
}
