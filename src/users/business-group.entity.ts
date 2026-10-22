import { Column, Entity, Index, VersionColumn } from 'typeorm';
import { AuditedEntity } from '../common/entities/audited.entity';

@Entity('business_groups')
@Index('uq_business_groups_name', ['name'], { unique: true })
export class BusinessGroupEntity extends AuditedEntity {
  @Column({ type: 'varchar', length: 100 }) name: string;
  @Column({ type: 'text', default: 'enabled' }) status: 'enabled' | 'disabled';
  @VersionColumn({ type: 'integer', default: 1 }) version: number;
}
