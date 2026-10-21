import { HttpStatus, Injectable, StreamableFile } from '@nestjs/common';
import { Readable } from 'node:stream';
import { DataSource } from 'typeorm';
import { AuthenticatedUser } from '../auth/auth.types';
import { BusinessException } from '../common/exceptions/business.exception';
import { WebsiteCreateInquiryDto } from '../website/website.dto';
import { WebsiteService } from '../website/website.service';
import { WebsiteVisitsQuery } from './website-visits.dto';
import {
  VisitRow,
  VISIT_COLUMNS,
  WebsiteVisitsReader,
} from './website-visits-reader';

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
export function visitCsvCell(value: string | Date | null | undefined) {
  let text =
    value == null ? '' : value instanceof Date ? value.toISOString() : value;
  // Spreadsheet formulas can hide behind leading ASCII control characters.
  // eslint-disable-next-line no-control-regex
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text))
    text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
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
    message: '该访问记录已生成询盘，请刷新列表',
    status: HttpStatus.CONFLICT,
  });
}
@Injectable()
export class WebsiteVisitsService {
  constructor(
    private readonly reader: WebsiteVisitsReader,
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
  private filter(query: WebsiteVisitsQuery, required = false) {
    if (
      (required && (!query.start || !query.end)) ||
      Boolean(query.start) !== Boolean(query.end) ||
      (query.start && query.end && query.start > query.end)
    )
      throw new BusinessException({
        code: 'VALIDATION_ERROR',
        message: '请选择有效的开始和结束日期',
        status: HttpStatus.BAD_REQUEST,
      });
    const values: unknown[] = [];
    const clauses: string[] = [];
    if (query.start && query.end) {
      values.push(
        `${query.start}T00:00:00+08:00`,
        `${query.end}T00:00:00+08:00`,
      );
      clauses.push(
        "created_at_utc >= $1::timestamptz AND created_at_utc < $2::timestamptz + interval '1 day'",
      );
    }
    if (query.keyword?.trim()) {
      const p = `$${values.push(`%${query.keyword.trim()}%`)}`;
      clauses.push(
        `(whatsapp_reference ILIKE ${p} OR website_inquiry_id ILIKE ${p})`,
      );
    }
    return {
      where: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '',
      values,
    };
  }
  private async row(id: string) {
    const rows = await this.reader.read((r) =>
      r.manager.query<VisitRow[]>(
        `SELECT ${VISIT_COLUMNS.join(',')} FROM public.lynx_visits WHERE id=$1`,
        [id],
      ),
    );
    if (!rows[0])
      throw new BusinessException({
        code: 'NOT_FOUND',
        message: '访问记录不存在',
        status: HttpStatus.NOT_FOUND,
      });
    return rows[0];
  }
  async list(query: WebsiteVisitsQuery, user: AuthenticatedUser) {
    this.access(user);
    const { where, values } = this.filter(query);
    const result = await this.reader.read(async (runner) => {
      const [count] = await runner.manager.query<{ total: string }[]>(
        `SELECT count(*)::text AS total FROM public.lynx_visits${where}`,
        values,
      );
      const list = await runner.manager.query<VisitRow[]>(
        `SELECT ${VISIT_COLUMNS.join(',')} FROM public.lynx_visits${where} ORDER BY created_at_utc DESC,id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, query.pageSize, (query.page - 1) * query.pageSize],
      );
      return {
        list,
        total: Number(count.total),
        page: query.page,
        pageSize: query.pageSize,
      };
    });
    const linked = await this.db.query<
      { visitId: string; id: string; code: string; ownerId: string }[]
    >(
      `SELECT v.visit_id AS "visitId",i.id,i.code,i.owner_id AS "ownerId" FROM website_visit_inquiries v JOIN website_inquiries i ON i.id=v.inquiry_id WHERE v.visit_id=ANY($1::uuid[]) AND i.business_unit='website'`,
      [result.list.map((row) => row.id)],
    );
    const all =
      user.scope === 'headquarters' || user.roles.includes('BUSINESS_MANAGER');
    return {
      ...result,
      list: result.list.map((row) => {
        const link = linked.find((x) => x.visitId === row.id);
        return {
          ...row,
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
    return visitInquiryDraft(await this.row(id));
  }
  async create(
    id: string,
    input: WebsiteCreateInquiryDto,
    user: AuthenticatedUser,
  ) {
    this.creator(user);
    if (input.businessUnit && input.businessUnit !== 'website') denied();
    await this.row(id);
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
  async export(query: WebsiteVisitsQuery, user: AuthenticatedUser) {
    this.access(user, 'website:visit:export');
    const { where, values } = this.filter(query, true);
    const runner = await this.reader.connect();
    let first: VisitRow[];
    try {
      await runner.query(
        `DECLARE export_visits NO SCROLL CURSOR FOR SELECT ${VISIT_COLUMNS.join(',')} FROM public.lynx_visits${where} ORDER BY created_at_utc DESC,id DESC`,
        values,
      );
      first = await runner.manager.query<VisitRow[]>(
        'FETCH FORWARD 500 FROM export_visits',
      );
    } catch {
      try {
        await runner.query('ROLLBACK');
      } finally {
        await runner.release();
      }
      return this.reader.unavailable();
    }
    async function* chunks() {
      try {
        yield '\uFEFF' + VISIT_COLUMNS.map(visitCsvCell).join(',') + '\r\n';
        let rows = first;
        while (rows.length) {
          for (const row of rows)
            yield VISIT_COLUMNS.map((key) => visitCsvCell(row[key])).join(',') +
              '\r\n';
          rows = await runner.manager.query<VisitRow[]>(
            'FETCH FORWARD 500 FROM export_visits',
          );
        }
      } finally {
        try {
          await runner.query('ROLLBACK');
        } finally {
          await runner.release();
        }
      }
    }
    return new StreamableFile(Readable.from(chunks()), {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="lynxtour-visits_${query.start}_${query.end}.csv"`,
    });
  }
}
