import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('lynx_visits')
export class LynxVisit {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({
    name: 'whatsapp_reference',
    type: 'varchar',
    length: 128,
    unique: true,
  })
  whatsappReference!: string;
  @Column({ name: 'website_inquiry_id', type: 'varchar', length: 128 })
  websiteInquiryId!: string;
  @Column({ name: 'contract_version', type: 'varchar', length: 16 })
  contractVersion!: string;
  @Column({ name: 'first_landing_page', type: 'text', nullable: true })
  firstLandingPage!: string | null;
  @Column({ name: 'external_referrer', type: 'text', nullable: true })
  externalReferrer!: string | null;
  @Column({ name: 'utm_source', type: 'text', nullable: true }) utmSource!:
    string | null;
  @Column({ name: 'utm_medium', type: 'text', nullable: true }) utmMedium!:
    string | null;
  @Column({ name: 'utm_campaign', type: 'text', nullable: true }) utmCampaign!:
    string | null;
  @Column({ name: 'utm_term', type: 'text', nullable: true }) utmTerm!:
    string | null;
  @Column({ name: 'utm_content', type: 'text', nullable: true }) utmContent!:
    string | null;
  @Column({ type: 'text', nullable: true }) gclid!: string | null;
  @Column({ type: 'text', nullable: true }) gbraid!: string | null;
  @Column({ type: 'text', nullable: true }) wbraid!: string | null;
  @CreateDateColumn({ name: 'created_at_utc', type: 'timestamptz' })
  createdAtUtc!: Date;
  @Column({ name: 'expires_at_utc', type: 'timestamptz' }) expiresAtUtc!: Date;
  @Column({ name: 'payload_fingerprint', type: 'char', length: 64 })
  payloadFingerprint!: string;
}
