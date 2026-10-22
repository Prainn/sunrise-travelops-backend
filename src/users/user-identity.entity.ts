import { BusinessGroupEntity } from './business-group.entity';
import { CoordinatorDuty } from './coordinator-assignment';
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UserEntity } from './user.entity';
import { RoleEntity } from '../roles/role.entity';
export const LOGIN_SCOPES = [
  'headquarters',
  'shengxu',
  'linxi',
  'website',
] as const;
export type LoginScope = (typeof LOGIN_SCOPES)[number];
export type BusinessUnit = Exclude<LoginScope, 'headquarters'>;
export const SCOPE_NAMES: Record<LoginScope, string> = {
  headquarters: '总部',
  shengxu: '盛旭',
  linxi: '霖熹',
  website: '独立站',
};
@Entity('user_identities')
@Index('UQ_identity_login', ['scope', 'username'], { unique: true })
@Index('UQ_identity_user_scope', ['userId', 'scope'], { unique: true })
export class UserIdentityEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId: string;
  @Column({ type: 'varchar', length: 80 }) username: string;
  @Column({ type: 'text' }) scope: LoginScope;
  @Column({ name: 'dept_id', type: 'integer', nullable: true }) deptId:
    number | null;
  @Column({ name: 'coordinator_duty', type: 'text', nullable: true })
  coordinatorDuty: CoordinatorDuty | null;
  @Column({ name: 'business_group_id', type: 'uuid', nullable: true })
  businessGroupId: string | null;
  @ManyToOne(() => BusinessGroupEntity)
  @JoinColumn({ name: 'business_group_id' })
  businessGroup: BusinessGroupEntity | null;
  @Column({ name: 'refresh_token_hash', type: 'text', nullable: true })
  refreshTokenHash: string | null;
  @ManyToOne(() => UserEntity, (u) => u.identities)
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;
  @ManyToMany(() => RoleEntity)
  @JoinTable({
    name: 'identity_roles',
    joinColumn: { name: 'identity_id' },
    inverseJoinColumn: { name: 'role_id' },
  })
  roles: RoleEntity[];
}
