import { AuditedEntity } from '../common/entities/audited.entity';
import { UserIdentityEntity } from './user-identity.entity';
import {
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  OneToMany,
  VersionColumn,
} from 'typeorm';

export enum UserStatus {
  Enabled = 'enabled',
  Disabled = 'disabled',
}

@Entity({ name: 'users' })
@Index('IDX_users_status', ['status'], { where: '"deleted_at" IS NULL' })
export class UserEntity extends AuditedEntity {
  @Column({ name: 'is_superuser', type: 'boolean', default: false })
  isSuperuser: boolean;
  @Column({ type: 'varchar', length: 80 })
  username: string;

  @Column({ name: 'password_hash', type: 'varchar', length: 255 })
  passwordHash: string;

  @Column({ type: 'varchar', length: 100 })
  nickname: string;

  @Column({ type: 'varchar', length: 500, default: '' })
  avatar: string;

  @Column({ type: 'smallint', default: 0 })
  gender: number;

  @Column({ type: 'varchar', length: 30, default: '' })
  mobile: string;

  @Column({ type: 'varchar', length: 254, default: '' })
  email: string;

  @Column({ type: 'enum', enum: UserStatus, default: UserStatus.Enabled })
  status: UserStatus;

  @VersionColumn({ type: 'integer', default: 1 })
  version: number;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;

  @OneToMany(() => UserIdentityEntity, (identity) => identity.user)
  identities: UserIdentityEntity[];
}
