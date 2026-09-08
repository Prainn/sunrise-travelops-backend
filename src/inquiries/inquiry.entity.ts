import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  VersionColumn,
} from 'typeorm';
import { AuditedEntity } from '../common/entities/audited.entity';
import type { ItineraryInput, LogAction } from './inquiry.dto';
import type {
  ItineraryRecord,
  ItineraryQuoteCalculation,
} from './itinerary.types';
export interface InquiryData {
  agencyId: string;
  contactId: string;
  agencyCode: string;
  agencyName: string;
  contactName: string;
  email: string;
  phone: string;
  countryOrRegion: string;
  sourceChannel: string;
  originalMessage: string;
  internalRemark: string;
  plannedDays: number;
  nextFollowUpAt: string | null;
  lostReason: string;
}
@Entity('inquiries')
@Index('IDX_inquiries_owner_created', ['ownerId', 'createdAt'])
export class InquiryEntity extends AuditedEntity {
  @Column({ unique: true }) code: string;
  @Column({ name: 'owner_id', type: 'uuid' }) ownerId: string;
  @Column() owner: string;
  @Column({ default: 'new' }) status: string;
  @Column() creator: string;
  @Column({ type: 'jsonb' }) data: InquiryData;
  @VersionColumn() version: number;
}
@Entity('itineraries')
@Index('IDX_itineraries_inquiry_updated', ['inquiryId', 'updatedAt'])
export class ItineraryEntity extends AuditedEntity {
  @Column({ name: 'inquiry_id', type: 'uuid' }) inquiryId: string;
  @Column({ unique: true }) code: string;
  @Column({ default: 'draft' }) status: 'draft' | 'quoted';
  @Column() creator: string;
  @Column({ type: 'jsonb' }) data: ItineraryInput;
  @VersionColumn() version: number;
}
export interface FieldChange {
  context?: {
    dayNumber?: number;
    name?: string;
    destination?: string;
    hotelTier?: string;
    vehicleTier?: string;
  };
  path: string;
  kind: 'added' | 'removed' | 'changed';
  before: unknown;
  after: unknown;
}
@Entity('inquiry_logs')
@Index('IDX_inquiry_logs_inquiry_time', ['inquiryId', 'occurredAt'])
@Index('IDX_inquiry_logs_operator_time', ['operatorId', 'occurredAt'])
@Index('IDX_inquiry_logs_time', ['occurredAt'])
export class InquiryLogEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'inquiry_id', type: 'uuid' }) inquiryId: string;
  @Column({ name: 'inquiry_code' }) inquiryCode: string;
  @Column() action: LogAction;
  @CreateDateColumn({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt: Date;
  @Column({ name: 'operator_id', type: 'uuid' }) operatorId: string;
  @Column({ name: 'operator_username' }) operatorUsername: string;
  @Column({ name: 'operator_name' }) operatorName: string;
  @Column({ type: 'jsonb' }) roles: string[];
  @Column({ name: 'target_type' }) targetType: 'inquiry' | 'itinerary';
  @Column({ name: 'target_id', type: 'uuid' }) targetId: string;
  @Column({ name: 'target_code' }) targetCode: string;
  @Column() summary: string;
  @Column({ type: 'jsonb' }) metadata: Record<string, unknown>;
  @Column({ type: 'jsonb' }) changes: FieldChange[];
  @Column({ default: '' }) ip: string;
  @Column({ name: 'request_id', default: '' }) requestId: string;
}
export interface PdfData {
  inquiry: InquiryData & {
    id: string;
    code: string;
    ownerId: string;
    owner: string;
    status: string;
    creator: string;
    createdAt: string;
    updatedAt: string;
    version: number;
  };
  itinerary: ItineraryRecord & { version: number };
  inquiryVersion: number;
  generatedAt: string;
  quoteCode: string;
  quoteVersion: number;
  calculation: ItineraryQuoteCalculation;
}
@Entity('itinerary_quotes')
export class ItineraryQuoteEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'itinerary_id', type: 'uuid', unique: true })
  itineraryId: string;
  @Column({ name: 'source_version' }) sourceVersion: number;
  @Column({ name: 'created_by', type: 'uuid' }) createdBy: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
  @Column({ type: 'jsonb' }) snapshot: PdfData;
}
