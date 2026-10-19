import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AuthenticatedUser } from '../auth/auth.types';
import {
  DirectLedgerInputDto,
  DirectLedgerQueryDto,
  LedgerOperationDto,
  UpdateDirectLedgerDto,
} from './ledger.dto';
import {
  assertVersion,
  COORDINATOR_FROM,
  conflict,
  coordinator,
  directUnit,
  forbidden,
  invalid,
  isManager,
  missing,
  requirePermission,
} from './ledger-access';

interface DirectRow {
  id: string;
  businessUnit: 'linxi' | 'website';
  creatorId: string;
  operatorId: string;
  operatorName: string;
  receivingAccountId: string | null;
  receivingAccountName: string;
  orderStatus: 'unconverted' | 'converted';
  reviewedAt: Date | null;
  operatedAt: Date | null;
  operated: boolean;
  version: number;
}
const SELECT = `id,business_unit AS "businessUnit",order_no AS "orderNo",received_date::text AS "receivedDate",
 to_char(received_date,'YYYY-MM') AS "receivedMonth",source,creator_id AS "creatorId",creator_name AS "creatorName",
 receiving_account_id AS "receivingAccountId",receiving_account_name AS "receivingAccountName",operator_id AS "operatorId",operator_name AS "operatorName",
 order_status AS "orderStatus",effective_contact AS "effectiveContact",proposal_sent AS "proposalSent",loss,priority,itinerary,
 not_converted_reason AS "notConvertedReason",loss_note AS "lossNote",remark,feedback_reason AS "feedbackReason",solution,
 deal_date::text AS "dealDate",departure_date::text AS "departureDate",complaint,satisfied,
 reviewed_at AS "reviewedAt",reviewed_by AS "reviewedBy",operated,operated_at AS "operatedAt",
 version,created_at AS "createdAt",updated_at AS "updatedAt",updated_by AS "updatedBy"`;

@Injectable()
export class DirectLedgersService {
  constructor(private readonly db: DataSource) {}
  private access(actor: AuthenticatedUser, action = 'list') {
    requirePermission(actor, `ledger:direct:${action}`);
    if (actor.scope === 'headquarters') {
      if (action !== 'list') forbidden();
    } else if (!['linxi', 'website'].includes(actor.scope)) forbidden();
  }
  private manageable(row: DirectRow, actor: AuthenticatedUser) {
    return (
      actor.scope === row.businessUnit &&
      (isManager(actor) ||
        row.creatorId === actor.id ||
        row.operatorId === actor.id)
    );
  }
  private present(row: DirectRow, actor: AuthenticatedUser) {
    const manage = this.manageable(row, actor);
    const edit =
      manage &&
      !row.reviewedAt &&
      actor.permissions.includes('ledger:direct:update');
    return {
      ...row,
      capabilities: {
        canEdit: edit,
        canDelete:
          manage &&
          !row.reviewedAt &&
          row.orderStatus === 'unconverted' &&
          !row.operatedAt &&
          actor.permissions.includes('ledger:direct:delete'),
        canReview:
          actor.scope === row.businessUnit &&
          isManager(actor) &&
          !row.reviewedAt &&
          actor.permissions.includes('ledger:direct:review'),
        canOperate:
          actor.scope === row.businessUnit &&
          actor.id === row.operatorId &&
          row.orderStatus === 'converted' &&
          actor.permissions.includes('ledger:direct:operate'),
        canChangeStatus:
          edit &&
          (actor.id === row.creatorId || isManager(actor)) &&
          !row.operatedAt,
      },
    };
  }
  private async row(
    manager: EntityManager,
    id: string,
    actor: AuthenticatedUser,
    lock = false,
  ) {
    const params: unknown[] = [id];
    const scope =
      actor.scope === 'headquarters'
        ? ''
        : ` AND business_unit=$${params.push(actor.scope)}`;
    const [row] = await manager.query<DirectRow[]>(
      `SELECT ${SELECT} FROM direct_ledgers WHERE id=$1${scope}${lock ? ' FOR UPDATE' : ''}`,
      params,
    );
    return row ?? missing();
  }
  async list(query: DirectLedgerQueryDto, actor: AuthenticatedUser) {
    this.access(actor);
    const unit = directUnit(actor, query.businessUnit);
    if (query.from && query.to && query.from > query.to)
      invalid('开始日期不能晚于结束日期');
    const params: unknown[] = [unit];
    let where = 'WHERE business_unit=$1';
    if (query.from)
      where += ` AND received_date >= $${params.push(query.from)}`;
    if (query.to) where += ` AND received_date <= $${params.push(query.to)}`;
    if (query.creatorId)
      where += ` AND creator_id=$${params.push(query.creatorId)}`;
    if (query.orderStatus)
      where += ` AND order_status=$${params.push(query.orderStatus)}`;
    if (query.keyword?.trim()) {
      const p = `$${params.push(`%${query.keyword.trim()}%`)}`;
      where += ` AND (order_no ILIKE ${p} OR source ILIKE ${p} OR creator_name ILIKE ${p} OR receiving_account_name ILIKE ${p} OR operator_name ILIKE ${p} OR itinerary ILIKE ${p})`;
    }
    const [count] = await this.db.query<{ total: string }[]>(
      `SELECT count(*) AS total FROM direct_ledgers ${where}`,
      params,
    );
    const list = await this.db.query<DirectRow[]>(
      `SELECT ${SELECT} FROM direct_ledgers ${where} ORDER BY received_date DESC,created_at DESC,id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.pageSize, (query.page - 1) * query.pageSize],
    );
    return {
      list: list.map((row) => this.present(row, actor)),
      total: Number(count.total),
      page: query.page,
      pageSize: query.pageSize,
    };
  }
  async get(id: string, actor: AuthenticatedUser) {
    this.access(actor);
    return this.present(await this.row(this.db.manager, id, actor), actor);
  }
  async operators(query: DirectLedgerQueryDto, actor: AuthenticatedUser) {
    this.access(actor);
    const unit = directUnit(actor, query.businessUnit);
    const params: unknown[] = [unit];
    let from = COORDINATOR_FROM;
    if (query.keyword?.trim())
      from += ` AND u.nickname ILIKE $${params.push(`%${query.keyword.trim()}%`)}`;
    const [count] = await this.db.query<{ total: string }[]>(
      `SELECT count(DISTINCT u.id) AS total ${from}`,
      params,
    );
    const list = await this.db.query<Record<string, unknown>[]>(
      `SELECT DISTINCT u.id,u.nickname AS name ${from} ORDER BY name,u.id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.pageSize, (query.page - 1) * query.pageSize],
    );
    return {
      list,
      total: Number(count.total),
      page: query.page,
      pageSize: query.pageSize,
    };
  }
  private async values(
    manager: EntityManager,
    input: DirectLedgerInputDto,
    unit: string,
    existing?: DirectRow,
  ) {
    const operator =
      existing?.operatorId === input.operatorId
        ? { name: existing.operatorName }
        : await coordinator(manager, input.operatorId, unit);
    let account: { name: string };
    if (unit === 'website') {
      if (input.receivingAccountId != null)
        invalid('独立站接单账号固定为独立站');
      account = { name: '独立站' };
    } else {
      if (!input.receivingAccountId) invalid('霖熹接单账号必填');
      account =
        existing?.receivingAccountId === input.receivingAccountId
          ? { name: existing.receivingAccountName }
          : await coordinator(manager, input.receivingAccountId, unit);
    }
    return {
      received_date: input.receivedDate,
      source: input.source,
      receiving_account_id: input.receivingAccountId ?? null,
      receiving_account_name: account.name,
      operator_id: input.operatorId,
      operator_name: operator.name,
      order_status: input.orderStatus,
      effective_contact: input.effectiveContact,
      proposal_sent: input.proposalSent,
      loss: input.loss,
      priority: input.priority,
      itinerary: input.itinerary,
      not_converted_reason: input.notConvertedReason,
      loss_note: input.lossNote,
      remark: input.remark,
      feedback_reason: input.feedbackReason,
      solution: input.solution,
      deal_date: input.dealDate,
      departure_date: input.departureDate,
      complaint: input.complaint,
      satisfied: input.satisfied,
    };
  }
  async create(input: DirectLedgerInputDto, actor: AuthenticatedUser) {
    this.access(actor, 'create');
    const unit = directUnit(actor);
    return this.db.transaction(async (manager) => {
      const data = {
        ...(await this.values(manager, input, unit)),
        business_unit: unit,
        creator_id: actor.id,
        creator_name: actor.nickname,
        updated_by: actor.id,
      };
      const [row] = await manager.query<DirectRow[]>(
        `INSERT INTO direct_ledgers(${Object.keys(data).join(',')}) VALUES(${Object.keys(
          data,
        )
          .map((_, i) => `$${i + 1}`)
          .join(',')}) RETURNING ${SELECT}`,
        Object.values(data),
      );
      return this.present(row, actor);
    });
  }
  async update(
    id: string,
    input: UpdateDirectLedgerDto,
    actor: AuthenticatedUser,
  ) {
    this.access(actor, 'update');
    return this.db.transaction(async (manager) => {
      const row = await this.row(manager, id, actor, true);
      if (!this.manageable(row, actor)) forbidden();
      assertVersion(row.version, input.version);
      if (row.reviewedAt) conflict('已审核台账仅允许指定操作计调更新是否操作');
      if (
        row.orderStatus !== input.orderStatus &&
        row.creatorId !== actor.id &&
        !isManager(actor)
      )
        forbidden();
      if (row.operatedAt && input.orderStatus !== 'converted')
        conflict('已操作台账不能改回未成团');
      const data = {
        ...(await this.values(manager, input, row.businessUnit, row)),
        updated_by: actor.id,
      };
      const [[saved]] = await manager.query<[DirectRow[], number]>(
        `UPDATE direct_ledgers SET ${Object.keys(data)
          .map((key, i) => `${key}=$${i + 2}`)
          .join(
            ',',
          )},version=version+1,updated_at=now() WHERE id=$1 RETURNING ${SELECT}`,
        [id, ...Object.values(data)],
      );
      return this.present(saved, actor);
    });
  }
  async review(id: string, version: number, actor: AuthenticatedUser) {
    this.access(actor, 'review');
    if (!isManager(actor)) forbidden();
    return this.db.transaction(async (manager) => {
      const row = await this.row(manager, id, actor, true);
      assertVersion(row.version, version);
      if (row.reviewedAt) conflict('台账已审核');
      const [[saved]] = await manager.query<[DirectRow[], number]>(
        `UPDATE direct_ledgers SET reviewed_at=now(),reviewed_by=$2,updated_by=$2,updated_at=now(),version=version+1 WHERE id=$1 RETURNING ${SELECT}`,
        [id, actor.id],
      );
      return this.present(saved, actor);
    });
  }
  async operate(
    id: string,
    input: LedgerOperationDto,
    actor: AuthenticatedUser,
  ) {
    this.access(actor, 'operate');
    return this.db.transaction(async (manager) => {
      const row = await this.row(manager, id, actor, true);
      if (row.operatorId !== actor.id) forbidden();
      assertVersion(row.version, input.version);
      if (row.orderStatus !== 'converted') conflict('已成团后才能更新是否操作');
      const [[saved]] = await manager.query<[DirectRow[], number]>(
        `UPDATE direct_ledgers SET operated=$2,operated_at=CASE WHEN $2 THEN coalesce(operated_at,now()) ELSE operated_at END,updated_by=$3,updated_at=now(),version=version+1 WHERE id=$1 RETURNING ${SELECT}`,
        [id, input.operated, actor.id],
      );
      return this.present(saved, actor);
    });
  }
  async delete(id: string, version: number, actor: AuthenticatedUser) {
    this.access(actor, 'delete');
    await this.db.transaction(async (manager) => {
      const row = await this.row(manager, id, actor, true);
      if (!this.manageable(row, actor)) forbidden();
      assertVersion(row.version, version);
      if (row.reviewedAt || row.orderStatus === 'converted' || row.operatedAt)
        conflict('已审核、已成团或已操作的台账不能删除');
      await manager.query('DELETE FROM direct_ledgers WHERE id=$1', [id]);
    });
  }
}
