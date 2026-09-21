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
  LegacyQuoteCalculation,
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
  @Column({ name: 'business_unit', type: 'text' }) businessUnit: string;
  @Column({ name: 'agency_id', type: 'uuid' })
  agencyId: InquiryData['agencyId'];
  @Column({ name: 'contact_id', type: 'uuid' })
  contactId: InquiryData['contactId'];
  @Column({ name: 'agency_code', type: 'text' })
  agencyCode: InquiryData['agencyCode'];
  @Column({ name: 'agency_name', type: 'text' })
  agencyName: InquiryData['agencyName'];
  @Column({ name: 'contact_name', type: 'text' })
  contactName: InquiryData['contactName'];
  @Column({ name: 'email', type: 'text' }) email: InquiryData['email'];
  @Column({ name: 'phone', type: 'text' }) phone: InquiryData['phone'];
  @Column({ name: 'country_or_region', type: 'text' })
  countryOrRegion: InquiryData['countryOrRegion'];
  @Column({ name: 'source_channel', type: 'text' })
  sourceChannel: InquiryData['sourceChannel'];
  @Column({ name: 'original_message', type: 'text' })
  originalMessage: InquiryData['originalMessage'];
  @Column({ name: 'internal_remark', type: 'text' })
  internalRemark: InquiryData['internalRemark'];
  @Column({ name: 'planned_days', type: 'integer' })
  plannedDays: InquiryData['plannedDays'];
  @Column({ name: 'next_follow_up_at', type: 'text', nullable: true })
  nextFollowUpAt: InquiryData['nextFollowUpAt'];
  @Column({ name: 'lost_reason', type: 'text' })
  lostReason: InquiryData['lostReason'];
  get data(): InquiryData {
    return {
      agencyId: this.agencyId,
      contactId: this.contactId,
      agencyCode: this.agencyCode,
      agencyName: this.agencyName,
      contactName: this.contactName,
      email: this.email,
      phone: this.phone,
      countryOrRegion: this.countryOrRegion,
      sourceChannel: this.sourceChannel,
      originalMessage: this.originalMessage,
      internalRemark: this.internalRemark,
      plannedDays: this.plannedDays,
      nextFollowUpAt: this.nextFollowUpAt,
      lostReason: this.lostReason,
    };
  }
  set data(value: InquiryData) {
    this.agencyId = value.agencyId;
    this.contactId = value.contactId;
    this.agencyCode = value.agencyCode;
    this.agencyName = value.agencyName;
    this.contactName = value.contactName;
    this.email = value.email;
    this.phone = value.phone;
    this.countryOrRegion = value.countryOrRegion;
    this.sourceChannel = value.sourceChannel;
    this.originalMessage = value.originalMessage;
    this.internalRemark = value.internalRemark;
    this.plannedDays = value.plannedDays;
    this.nextFollowUpAt = value.nextFollowUpAt;
    this.lostReason = value.lostReason;
  }
  @VersionColumn() version: number;
}
@Entity('itineraries')
@Index('IDX_itineraries_inquiry_updated', ['inquiryId', 'updatedAt'])
export class ItineraryEntity extends AuditedEntity {
  @Column({ name: 'inquiry_id', type: 'uuid' }) inquiryId: string;
  @Column({ unique: true }) code: string;
  @Column({ default: 'draft' }) status: 'draft' | 'quoted';
  @Column() creator: string;
  data: ItineraryInput;
  @Column({ name: 'title', type: 'text' }) title: string;
  @Column({ name: 'start_date', type: 'text' }) startDate: string;
  @Column({ name: 'pax_tiers', type: 'integer', array: true })
  paxTiers: number[];
  @Column({ name: 'child_rate', type: 'double precision' }) childRate: number;
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
export interface CurrentPdfData {
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
/** Historical migration input: preserve the pre-PAX snapshot contract. */
export interface PdfData extends Omit<
  CurrentPdfData,
  'itinerary' | 'calculation'
> {
  itinerary: Omit<
    CurrentPdfData['itinerary'],
    'paxTiers' | 'childRate' | 'quote'
  > & {
    adults: number;
    childrenCount: number;
    leaderCount: number;
    quote: Omit<
      ItineraryRecord['quote'],
      | 'options'
      | 'guideServiceTotal'
      | 'staffRoomCosts'
      | 'mealOtherCost'
      | 'mealOtherReason'
      | 'attractionOtherCost'
      | 'attractionOtherReason'
    > & {
      otherExpenses: number | null;
      options: Array<{
        id: string;
        hotelTier: ItineraryRecord['hotelPlans'][number]['tier'];
        vehicleTier: ItineraryRecord['vehiclePlans'][number]['tier'];
        adultUnitPrice: number | null;
        leaderFocEnabled: boolean;
      }>;
    };
  };
  calculation: LegacyQuoteCalculation;
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
  @Column({ name: 'quote_code', type: 'text' }) quoteCode: string;
  @Column({ name: 'quote_version', type: 'integer' }) quoteVersion: number;
  @Column({ name: 'inquiry_id', type: 'uuid' }) inquiryId: string;
  @Column({ name: 'inquiry_version', type: 'integer' }) inquiryVersion: number;
  @Column({ name: 'hotel_guest_count', type: 'integer', nullable: true })
  hotelGuestCount: number | null;
  @Column({ name: 'hotel_room_count', type: 'integer', nullable: true })
  hotelRoomCount: number | null;
  @Column({ name: 'daily_resource_cost', type: 'numeric' })
  dailyResourceCost: number;
  @Column({ name: 'guide_cost', type: 'numeric' }) guideCost: number;
  @Column({ type: 'jsonb' }) snapshot: CurrentPdfData;
}
