import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthenticatedUser } from '../auth/auth.types';
import { ErrorCode } from '../common/constants/error-code';
import {
  conflict,
  forbidden,
  invalid,
  isLedgerRoot,
  isManager,
  missing,
  requirePermission,
} from './ledger-access';
import {
  SummaryNotesDto,
  SummaryQueryDto,
  SummaryReport,
} from './ledger-summaries.dto';

export interface SummaryNotes {
  firstFollowUp: string;
  tourNumbers: string;
  version: number;
}
export interface SummaryRow extends SummaryNotes {
  id: string;
  name: string;
  quotedCount: number;
  convertedCount: number;
  reasons: { ledgerId: string; date: string; text: string }[];
  canEdit: boolean;
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
        quoted_groups AS quoted,converted_groups AS converted,not_converted_reason AS reason
        FROM shengxu_ledgers`;
    }
    const platform = report.endsWith('-platform-summary');
    const website = report.startsWith('website-');
    return `SELECT id AS ledger_id,${platform ? (website ? "'website'::text" : 'receiving_group_id::text') : 'creator_id::text'} AS id,
      ${platform ? 'receiving_account_name' : 'creator_name'} AS name,received_date AS date,created_at,
      CASE WHEN proposal_sent THEN 1 ELSE 0 END AS quoted,
      CASE WHEN order_status='converted' THEN 1 ELSE 0 END AS converted,not_converted_reason AS reason
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
    const platform = report.endsWith('-platform-summary');
    const cte = `WITH source AS (${this.source(report)}), filtered AS (
      SELECT * FROM source ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
    ), grouped AS (
      SELECT id,(array_agg(name ORDER BY date DESC,created_at DESC,ledger_id DESC))[1] AS name,
        sum(quoted)::float8 AS "quotedCount",sum(converted)::float8 AS "convertedCount",
        ${
          platform
            ? "'[]'::jsonb"
            : `coalesce(jsonb_agg(jsonb_build_object('ledgerId',ledger_id,'date',date::text,'text',reason)
          ORDER BY date DESC,created_at DESC,ledger_id DESC) FILTER(WHERE btrim(reason)<>''),'[]'::jsonb)`
        } AS reasons
      FROM filtered GROUP BY id
    )`;
    const keyword = query.keyword?.trim();
    const where = keyword
      ? `WHERE g.name ILIKE $${params.push(`%${keyword}%`)}`
      : '';
    const canEdit =
      !platform &&
      isManager(actor) &&
      actor.permissions.includes('ledger:summary:update');
    return this.db.transaction('REPEATABLE READ', async (manager) => {
      const [{ total }] = await manager.query<{ total: number }[]>(
        `${cte} SELECT count(*)::int AS total FROM grouped g ${where}`,
        params,
      );
      const list = await manager.query<SummaryRow[]>(
        `${cte}
        SELECT g.*,coalesce(n.first_follow_up,'') AS "firstFollowUp",coalesce(n.tour_numbers,'') AS "tourNumbers",
          coalesce(n.version,0) AS version
        FROM grouped g LEFT JOIN ledger_summary_notes n ON n.report_key=$${params.length + 1} AND n.row_id::text=g.id
        ${where} ORDER BY g.name,g.id LIMIT $${params.length + 2} OFFSET $${params.length + 3}`,
        [...params, report, query.pageSize, (query.page - 1) * query.pageSize],
      );
      return {
        list: list.map((row) => ({ ...row, canEdit })),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }

  async saveNotes(
    report: SummaryReport,
    id: string,
    input: SummaryNotesDto,
    actor: AuthenticatedUser,
  ): Promise<SummaryNotes> {
    this.access(report, actor);
    requirePermission(actor, 'ledger:summary:update');
    if (!isManager(actor) || report.endsWith('-platform-summary')) forbidden();
    if (report === 'shengxu-agency-summary') {
      if (typeof input.firstFollowUp !== 'string')
        invalid('First follow-up is required');
    } else if (input.firstFollowUp !== undefined)
      invalid('First follow-up is not supported');
    return this.db.transaction(async (manager) => {
      const [exists] = await manager.query<{ id: string }[]>(
        `WITH source AS (${this.source(report)}) SELECT id FROM source WHERE id=$1 LIMIT 1`,
        [id],
      );
      if (!exists) missing();
      const [notes] = await manager.query<SummaryNotes[]>(
        `INSERT INTO ledger_summary_notes(report_key,row_id,first_follow_up,tour_numbers,updated_by)
        SELECT $1,$2,$3,$4,$5 WHERE $6::int=0
        ON CONFLICT(report_key,row_id) DO NOTHING
        RETURNING first_follow_up AS "firstFollowUp",tour_numbers AS "tourNumbers",version`,
        [
          report,
          id,
          input.firstFollowUp ?? '',
          input.tourNumbers,
          actor.id,
          input.version,
        ],
      );
      if (notes) return notes;
      const [[updated]] = await manager.query<[SummaryNotes[], number]>(
        `UPDATE ledger_summary_notes
        SET first_follow_up=$3,tour_numbers=$4,updated_by=$5,updated_at=now(),version=version+1
        WHERE report_key=$1 AND row_id=$2 AND version=$6
        RETURNING first_follow_up AS "firstFollowUp",tour_numbers AS "tourNumbers",version`,
        [
          report,
          id,
          input.firstFollowUp ?? '',
          input.tourNumbers,
          actor.id,
          input.version,
        ],
      );
      if (!updated)
        conflict(
          ErrorCode.LEDGER_VERSION_CONFLICT,
          'Summary has changed; refresh before saving',
        );
      return updated;
    });
  }
}
