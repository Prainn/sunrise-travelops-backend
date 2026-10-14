import { AuditedEntity } from '../../common/entities/audited.entity';
import { Column, DeleteDateColumn, VersionColumn } from 'typeorm';
import { ResourceStatus } from './resource.constants';

export abstract class VersionedResourceEntity extends AuditedEntity {
  @VersionColumn({ type: 'integer', default: 1 })
  version: number;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;
}

export abstract class TopLevelResourceEntity extends VersionedResourceEntity {
  @Column({ type: 'varchar', length: 50 })
  code: string;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ type: 'varchar', length: 20, default: ResourceStatus.Enabled })
  status: ResourceStatus;
}
