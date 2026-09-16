import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LynxVisit } from './lynx-visit.entity';
import { WhatsappRegisterDto } from './whatsapp-register.dto';

const EXPIRY_MS = 180 * 24 * 60 * 60 * 1000;
const EMAIL = /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i;

@Injectable()
export class WhatsappRegistryService {
  constructor(
    @InjectRepository(LynxVisit)
    private readonly visits: Repository<LynxVisit>,
  ) {}

  async register(body: WhatsappRegisterDto): Promise<boolean> {
    const payload = this.normalize(body);
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(payload))
      .digest('hex');
    const createdAtUtc = new Date();
    try {
      await this.visits.insert({
        ...payload,
        createdAtUtc,
        expiresAtUtc: new Date(createdAtUtc.getTime() + EXPIRY_MS),
        payloadFingerprint: fingerprint,
      });
      return true;
    } catch (error) {
      if (!this.isReferenceConflict(error)) throw error;
      const existing = await this.visits.findOneBy({
        whatsappReference: payload.whatsappReference,
      });
      if (existing?.payloadFingerprint === fingerprint) return false;
      throw new ConflictException('whatsapp_reference already registered');
    }
  }

  async resolve(reference: string): Promise<Record<string, string | null>> {
    if (!reference || reference.length > 128) throw new NotFoundException();
    const record = await this.visits.findOneBy({
      whatsappReference: reference,
    });
    if (!record || record.expiresAtUtc.getTime() <= Date.now()) {
      throw new NotFoundException();
    }
    return {
      whatsapp_reference: record.whatsappReference,
      website_inquiry_id: record.websiteInquiryId,
      contract_version: record.contractVersion,
      first_landing_page: record.firstLandingPage,
      external_referrer: record.externalReferrer,
      utm_source: record.utmSource,
      utm_medium: record.utmMedium,
      utm_campaign: record.utmCampaign,
      utm_term: record.utmTerm,
      utm_content: record.utmContent,
      gclid: record.gclid,
      gbraid: record.gbraid,
      wbraid: record.wbraid,
      created_at_utc: record.createdAtUtc.toISOString(),
      expires_at_utc: record.expiresAtUtc.toISOString(),
      payload_fingerprint: record.payloadFingerprint,
    };
  }

  private normalize(body: WhatsappRegisterDto) {
    const text = (value: string | null | undefined): string | null => {
      if (!value) return null;
      if (EMAIL.test(value))
        throw new BadRequestException('PII is not accepted');
      return value;
    };
    const url = (value: string | null | undefined): string | null => {
      if (!value) return null;
      let parsed: URL;
      try {
        parsed = new URL(value);
      } catch {
        throw new BadRequestException('Invalid URL');
      }
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new BadRequestException('Invalid URL');
      }
      return text(`${parsed.origin}${parsed.pathname}`);
    };
    if (
      EMAIL.test(body.whatsapp_reference) ||
      EMAIL.test(body.website_inquiry_id)
    ) {
      throw new BadRequestException('PII is not accepted');
    }
    return {
      whatsappReference: body.whatsapp_reference,
      websiteInquiryId: body.website_inquiry_id,
      contractVersion: body.contract_version,
      firstLandingPage: url(body.first_landing_page),
      externalReferrer: url(body.external_referrer),
      utmSource: text(body.utm_source),
      utmMedium: text(body.utm_medium),
      utmCampaign: text(body.utm_campaign),
      utmTerm: text(body.utm_term),
      utmContent: text(body.utm_content),
      gclid: text(body.gclid),
      gbraid: text(body.gbraid),
      wbraid: text(body.wbraid),
    };
  }

  private isReferenceConflict(error: unknown): boolean {
    if (
      typeof error !== 'object' ||
      error === null ||
      !('driverError' in error)
    ) {
      return false;
    }
    const driverError = error.driverError as {
      code?: string;
      constraint?: string;
    };
    return (
      driverError.code === '23505' &&
      driverError.constraint === 'UQ_lynx_visits_whatsapp_reference'
    );
  }
}
