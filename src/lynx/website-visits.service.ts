import { HttpStatus, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthenticatedUser } from '../auth/auth.types';
import { BusinessException } from '../common/exceptions/business.exception';
import { WebsiteCreateInquiryDto } from '../website/website.dto';
import { WebsiteService } from '../website/website.service';
import { WebsiteVisitsQuery } from './website-visits.dto';
import { VisitRow } from './website-visits-reader';
import { WebsiteVisitsSource } from './website-visits.source';

export function visitInquiryDraft(row: VisitRow) {
  const receivedAt = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(row.created_at_utc));
  return {
    businessUnit: 'website' as const,
    whatsappSourceId: row.whatsapp_reference,
    websiteInquiryNo: row.website_inquiry_id,
    landingPage: row.first_landing_page ?? '',
    receivedAt,
    contactChannel: 'WhatsApp',
    acquisitionSource: row.utm_source || row.external_referrer || '',
  };
}
function denied(): never {
  throw new BusinessException({
    code: 'AUTH_FORBIDDEN',
    message: '无权访问独立站访问记录',
    status: HttpStatus.FORBIDDEN,
  });
}
function conflict(): never {
  throw new BusinessException({
    code: 'CONFLICT',
    message: '该访问记录已新增询盘，请刷新列表',
    status: HttpStatus.CONFLICT,
  });
}
@Injectable()
export class WebsiteVisitsService {
  constructor(
    private readonly source: WebsiteVisitsSource,
    private readonly db: DataSource,
    private readonly website: WebsiteService,
  ) {}
  private access(user: AuthenticatedUser, permission = 'website:visit:list') {
    if (
      !['website', 'headquarters'].includes(user.scope) ||
      !user.permissions.includes(permission)
    )
      denied();
  }
  private creator(user: AuthenticatedUser) {
    this.access(user);
    if (!user.permissions.includes('website:inquiry:create')) denied();
  }
  async list(query: WebsiteVisitsQuery, user: AuthenticatedUser) {
    this.access(user);
    const result = await this.source.list(query);
    const linked = await this.db.query<
      { visitId: string; id: string; code: string; ownerId: string }[]
    >(
      `SELECT v.visit_id AS "visitId",i.id,i.code,i.owner_id AS "ownerId" FROM website_visit_inquiries v JOIN website_inquiries i ON i.id=v.inquiry_id WHERE v.visit_id=ANY($1::uuid[]) AND i.business_unit='website'`,
      [result.list.map((row) => row.id)],
    );
    const all =
      user.scope === 'headquarters' || user.roles.includes('BUSINESS_MANAGER');
    const confirmations = await this.db.query<{ visitId: string }[]>(
      'SELECT visit_id AS "visitId" FROM website_visit_confirmations WHERE visit_id=ANY($1::uuid[])',
      [result.list.map((row) => row.id)],
    );
    const confirmedIds = new Set(confirmations.map((entry) => entry.visitId));
    return {
      ...result,
      list: result.list.map((row) => {
        const link = linked.find((x) => x.visitId === row.id);
        return {
          ...row,
          confirmed: confirmedIds.has(row.id),
          converted: Boolean(link),
          inquiry:
            link &&
            user.permissions.includes('website:inquiry:list') &&
            (all || link.ownerId === user.id)
              ? { id: link.id, code: link.code }
              : null,
        };
      }),
    };
  }
  async confirm(id: string, user: AuthenticatedUser) {
    this.access(user);
    await this.source.row(id);
    await this.db.query(
      'INSERT INTO website_visit_confirmations(visit_id) VALUES($1) ON CONFLICT (visit_id) DO NOTHING',
      [id],
    );
    return { confirmed: true };
  }
  async draft(id: string, user: AuthenticatedUser) {
    this.creator(user);
    if (
      (
        await this.db.query<unknown[]>(
          'SELECT 1 FROM website_visit_inquiries WHERE visit_id=$1',
          [id],
        )
      ).length
    )
      conflict();
    return visitInquiryDraft(await this.source.row(id));
  }
  async create(
    id: string,
    input: WebsiteCreateInquiryDto,
    user: AuthenticatedUser,
  ) {
    this.creator(user);
    if (input.businessUnit && input.businessUnit !== 'website') denied();
    await this.source.row(id);
    return this.db.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `website-visit:${id}`,
      ]);
      if (
        (
          await manager.query<unknown[]>(
            'SELECT 1 FROM website_visit_inquiries WHERE visit_id=$1',
            [id],
          )
        ).length
      )
        conflict();
      const inquiry = await this.website.create(
        { ...input, businessUnit: 'website' },
        user,
        manager,
      );
      await manager.query(
        'INSERT INTO website_visit_inquiries(visit_id,inquiry_id) VALUES($1,$2)',
        [id, inquiry.id],
      );
      return inquiry;
    });
  }
  export(query: WebsiteVisitsQuery, user: AuthenticatedUser) {
    this.access(user, 'website:visit:export');
    return this.source.export(query);
  }
}
