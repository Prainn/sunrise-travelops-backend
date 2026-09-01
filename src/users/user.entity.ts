import { AuditedEntity } from '../common/entities/audited.entity';
import { RoleEntity } from '../roles/role.entity';
import { Column, Entity, JoinTable, ManyToMany } from 'typeorm';

export enum UserStatus {
  Enabled = 'enabled',
  Disabled = 'disabled',
}

@Entity({ name: 'users' })
export class UserEntity extends AuditedEntity {
  @Column({ type: 'varchar', length: 80, unique: true })
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

  @Column({ name: 'dept_id', type: 'integer', nullable: true })
  deptId: number | null;

  @Column({ type: 'enum', enum: UserStatus, default: UserStatus.Enabled })
  status: UserStatus;

  @Column({
    name: 'refresh_token_hash',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  refreshTokenHash: string | null;

  @ManyToMany(() => RoleEntity, (role) => role.users)
  @JoinTable({
    name: 'user_roles',
    joinColumn: { name: 'user_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'role_id', referencedColumnName: 'id' },
  })
  roles: RoleEntity[];
}
