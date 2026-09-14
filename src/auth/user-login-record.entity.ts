import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UserEntity } from '../users/user.entity';

@Entity({ name: 'user_login_records' })
@Index('IDX_user_login_records_user_time', ['userId', 'time', 'id'])
export class UserLoginRecordEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_user_login_records',
  })
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_user_login_records_user',
  })
  user: UserEntity;

  @CreateDateColumn({ type: 'timestamptz' })
  time: Date;

  @Column({ type: 'varchar', length: 64 })
  ip: string;

  @Column({ name: 'user_agent', type: 'varchar', length: 512 })
  userAgent: string;
}
