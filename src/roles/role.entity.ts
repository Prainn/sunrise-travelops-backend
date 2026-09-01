import { AuditedEntity } from '../common/entities/audited.entity';
import { UserEntity } from '../users/user.entity';
import { PermissionEntity } from './permission.entity';
import { Column, Entity, JoinTable, ManyToMany } from 'typeorm';

@Entity({ name: 'roles' })
export class RoleEntity extends AuditedEntity {
  @Column({ type: 'varchar', length: 60, unique: true })
  code: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ name: 'is_enabled', type: 'boolean', default: true })
  isEnabled: boolean;

  @ManyToMany(() => PermissionEntity, (permission) => permission.roles)
  @JoinTable({
    name: 'role_permissions',
    joinColumn: { name: 'role_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'permission_id', referencedColumnName: 'id' },
  })
  permissions: PermissionEntity[];

  @ManyToMany(() => UserEntity, (user) => user.roles)
  users: UserEntity[];
}
