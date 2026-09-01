import {
  Column,
  CreateDateColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export abstract class AuditedEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy: string | null;
}
