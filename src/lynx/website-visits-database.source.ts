import { HttpStatus, Injectable, StreamableFile } from '@nestjs/common';
import { Readable } from 'node:stream';
import { BusinessException } from '../common/exceptions/business.exception';
import { WebsiteVisitsQuery } from './website-visits.dto';
import {
  VisitRow,
  VISIT_COLUMNS,
  WebsiteVisitsReader,
} from './website-visits-reader';

export interface VisitPage {
  list: VisitRow[];
  total: number;
  page: number;
  pageSize: number;
}
export function validateVisitRange(
  query: WebsiteVisitsQuery,
  required = false,
) {
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

@Injectable()
export class WebsiteVisitsDatabaseSource {
  constructor(private readonly reader: WebsiteVisitsReader) {}
  private filter(query: WebsiteVisitsQuery, required = false) {
    validateVisitRange(query, required);
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
  async row(id: string) {
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
  async list(query: WebsiteVisitsQuery) {
    const { where, values } = this.filter(query);
    return this.reader.read(async (runner) => {
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
  }
  async export(query: WebsiteVisitsQuery) {
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
    let closing: Promise<void> | undefined;
    const close = () =>
      (closing ??= (async () => {
        try {
          await runner.query('ROLLBACK');
        } finally {
          await runner.release();
        }
      })());
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
        await close();
      }
    }
    const stream = Readable.from(chunks());
    // Also release a cursor if the client disconnects before the generator starts.
    stream.once('close', () => {
      void close().catch(() => undefined);
    });
    return new StreamableFile(stream, {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="lynxtour-visits_${query.start}_${query.end}.csv"`,
    });
  }
}
