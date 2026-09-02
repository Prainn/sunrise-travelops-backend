import { AuditedEntity } from '../../common/entities/audited.entity';
import {
  Column,
  Check,
  DeleteDateColumn,
  Entity,
  Index,
  OneToMany,
  Unique,
  VersionColumn,
} from 'typeorm';
import { DictionaryStatus } from './dictionary-status';
import { DictionaryItemEntity } from './dictionary-item.entity';

@Entity({ name: 'system_dictionary_types' })
@Unique('UQ_system_dictionary_types_dict_code', ['dictCode'])
@Check('CHK_system_dictionary_types_status', '"status" IN (0, 1)')
@Index('IDX_system_dictionary_types_status', ['status'], {
  where: '"deleted_at" IS NULL',
})
export class DictionaryTypeEntity extends AuditedEntity {
  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ name: 'dict_code', type: 'varchar', length: 100 })
  dictCode: string;

  @Column({ type: 'smallint', default: DictionaryStatus.Enabled })
  status: DictionaryStatus;

  @Column({ type: 'text', nullable: true })
  remark: string | null;

  @VersionColumn({ type: 'integer', default: 1 })
  version: number;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;

  @OneToMany(() => DictionaryItemEntity, (item) => item.dictionaryType)
  items: DictionaryItemEntity[];
}
