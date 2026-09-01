import { Column, Entity, ManyToMany, PrimaryGeneratedColumn } from 'typeorm';
import { RoleEntity } from './role.entity';

@Entity({ name: 'permissions' })
export class PermissionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  code: string;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @ManyToMany(() => RoleEntity, (role) => role.permissions)
  roles: RoleEntity[];
}
