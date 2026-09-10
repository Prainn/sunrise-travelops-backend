import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('lynx_visits')
export class LynxVisit {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'whatsapp_reference', type: 'varchar', length: 128 })
  whatsappReference!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'inet', nullable: true })
  ip!: string | null;

  @Column({ type: 'text' })
  browser!: string;
}
