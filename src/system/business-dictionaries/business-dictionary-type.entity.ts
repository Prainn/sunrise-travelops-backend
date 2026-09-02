import { AuditedEntity } from '../../common/entities/audited.entity';
import {
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  OneToMany,
  Unique,
  VersionColumn,
} from 'typeorm';
import { BusinessDictionaryItemEntity } from './business-dictionary-item.entity';

@Entity({ name: 'system_business_dictionary_types' })
@Unique('UQ_system_business_dictionary_types_code', ['code'])
@Index('IDX_system_business_dictionary_types_deleted_at', ['deletedAt'])
export class BusinessDictionaryTypeEntity extends AuditedEntity {
  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ name: 'english_name', type: 'varchar', length: 150 })
  englishName: string;

  @Column({ type: 'varchar', length: 100 })
  code: string;

  @Column({ name: 'is_built_in', type: 'boolean', default: false })
  builtIn: boolean;

  @VersionColumn({ type: 'integer', default: 1 })
  version: number;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;

  @OneToMany(() => BusinessDictionaryItemEntity, (item) => item.dictionaryType)
  items: BusinessDictionaryItemEntity[];
}
