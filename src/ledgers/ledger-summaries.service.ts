import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthenticatedUser } from '../auth/auth.types';
import {
  forbidden,
  invalid,
  isLedgerRoot,
  requirePermission,
} from './ledger-access';
import { SummaryQueryDto, SummaryReport } from './ledger-summaries.dto';

export interface SummaryRow {
  id: string;
  name: string;
  quotedCount: number;
  convertedCount: number;
}

@Injectable()
export class LedgerSummariesService {
  constructor(private readonly db: DataSource) {}

  private access(report: SummaryReport, actor: AuthenticatedUser) {
    requirePermission(actor, 'ledger:summary:list');
    const unit = report.startsWith('shengxu-')
      ? 'shengxu'
      : report.startsWith('linxi-')
        ? 'linxi'
        : 'website';
    if (actor.scope !== unit && actor.scope !== 'headquarters') forbidden();
    if (!isLedgerRoot(actor) && !actor.menuKeys.includes(report)) forbidden();
    return unit;
  }

  // Only normalized source columns vary; all user values remain SQL parameters.
  private source(report: SummaryReport) {
    if (report.startsWith('shengxu-')) {
      const agency = report === 'shengxu-agency-summary';
      return `SELECT id AS ledger_id, ${agency ? 'agency_id' : 'creator_id'}::text AS id,
        ${agency ? 'agency_name' : 'creator_name'} AS name,record_date AS date,created_at,
        quoted_groups AS quoted,converted_groups AS converted
        FROM shengxu_ledgers`;
    }
    const platform = report.endsWith('-platform-summary');
    const website = report.startsWith('website-');
    return `SELECT id AS ledger_id,${platform ? (website ? "'website'::text" : 'receiving_group_id::text') : 'creator_id::text'} AS id,
      ${platform ? 'receiving_account_name' : 'creator_name'} AS name,received_date AS date,created_at,
      CASE WHEN proposal_sent THEN 1 ELSE 0 END AS quoted,
      CASE WHEN order_status='converted' THEN 1 ELSE 0 END AS converted
      FROM direct_ledgers WHERE business_unit='${website ? 'website' : 'linxi'}'`;
  }

  async list(
    report: SummaryReport,
    query: SummaryQueryDto,
    actor: AuthenticatedUser,
  ) {
    this.access(report, actor);
    if (query.from && query.to && query.from > query.to)
      invalid('Invalid date range');
    const params: unknown[] = [];
    const filters: string[] = [];
    if (query.from) filters.push(`date >= $${params.push(query.from)}::date`);
    if (query.to) filters.push(`date <= $${params.push(query.to)}::date`);
    const cte = `WITH source AS (${this.source(report)}), filtered AS (
      SELECT * FROM source ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
    ), grouped AS (
      SELECT id,(array_agg(name ORDER BY date DESC,created_at DESC,ledger_id DESC))[1] AS name,
        sum(quoted)::float8 AS "quotedCount",sum(converted)::float8 AS "convertedCount"
      FROM filtered GROUP BY id
    )`;
    const keyword = query.keyword?.trim();
    const where = keyword
      ? `WHERE g.name ILIKE $${params.push(`%${keyword}%`)}`
      : '';
    return this.db.transaction('REPEATABLE READ', async (manager) => {
      const [{ total }] = await manager.query<{ total: number }[]>(
        `${cte} SELECT count(*)::int AS total FROM grouped g ${where}`,
        params,
      );
      const list = await manager.query<SummaryRow[]>(
        `${cte}
        SELECT g.* FROM grouped g
        ${where} ORDER BY g.name,g.id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, query.pageSize, (query.page - 1) * query.pageSize],
      );
      return {
        list,
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }
}
