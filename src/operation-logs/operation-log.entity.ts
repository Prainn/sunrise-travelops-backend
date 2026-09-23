import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('operation_logs')
export class OperationLogEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @CreateDateColumn({ type: 'timestamptz' }) time!: Date;
  @Column({ type: 'varchar', length: 32 }) category!: string;
  @Column({ type: 'varchar', length: 80 }) action!: string;
  @Column({ type: 'boolean' }) success!: boolean;
  @Column({ name: 'actor_id', type: 'uuid', nullable: true }) actorId!:
    string | null;
  @Column({ name: 'actor_name', type: 'varchar', length: 80 })
  actorName!: string;
  @Column({ type: 'varchar', length: 32, nullable: true }) scope!:
    string | null;
  @Column({ type: 'text', default: '{}' })
  detail!: string;
  @Column({ type: 'varchar', length: 64, nullable: true }) ip!: string | null;
}
