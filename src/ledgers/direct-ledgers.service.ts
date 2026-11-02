import { ToursService } from '../tours/tours.service';
import { ConvertDirectLedgerDto } from './ledger.dto';
import { DirectLedgerTourDto } from '../tours/tour.dto';
import { isFullAdministrator } from '../auth/account-access';
import { LedgerNotificationsService } from './ledger-notifications.service';
import { requireBusinessGroup } from '../users/coordinator-assignment';
import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ErrorCode } from '../common/constants/error-code';
import { AuthenticatedUser } from '../auth/auth.types';
import {
  DirectLedgerInputDto,
  DirectFilterOptionsQueryDto,
  CreateDirectLedgerDto,
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
  isLedgerRoot,
  missing,
  requirePermission,
} from './ledger-access';

interface DirectRow {
  id: string;
  countryItemId: string | null;
  countryCode: string | null;
  countryName: string | null;
  tours: Array<{ id: string; tourNo: string; status: string }>;
  orderNo: string;
  creatorName: string;
  source: string;
  lossNote: string;
  businessUnit: 'linxi' | 'website';
  creatorId: string;
  operatorId: string;
  operatorName: string;
  receivingGroupId: string | null;
  receivingAccountName: string;
  orderStatus: 'unconverted' | 'converted';
  proposalSent: boolean;
  loss: boolean;
  reviewedAt: Date | null;
  operatedAt: Date | null;
  operated: boolean;
  version: number;
}
const WORKFLOW_STATUS = `CASE WHEN operated THEN 'operated' WHEN loss AND reviewed_at IS NULL THEN 'pending_confirmation' ELSE 'pending_operation' END`;
const SELECT = `country_item_id AS "countryItemId",country_code AS "countryCode",country_name AS "countryName",
 COALESCE((SELECT jsonb_agg(jsonb_build_object('id',dt.id,'tourNo',dt.tour_no,'status',dt.status,'version',dt.version,
   'cancelReason',dt.cancel_reason,'cancelledAt',dt.cancelled_at,'createdAt',dt.created_at) ORDER BY dt.created_at DESC,dt.id DESC)
   FROM tours dt WHERE dt.direct_ledger_id=direct_ledgers.id),'[]'::jsonb) AS tours,
 id,business_unit AS "businessUnit",order_no AS "orderNo",received_date::text AS "receivedDate",
 source,creator_id AS "creatorId",creator_name AS "creatorName",
 receiving_group_id AS "receivingGroupId",receiving_account_name AS "receivingAccountName",operator_id AS "operatorId",operator_name AS "operatorName",
 order_status AS "orderStatus",effective_contact AS "effectiveContact",proposal_sent AS "proposalSent",loss,priority,itinerary,
 not_converted_reason AS "notConvertedReason",loss_note AS "lossNote",remark,feedback_reason AS "feedbackReason",solution,
 deal_date::text AS "dealDate",departure_date::text AS "departureDate",complaint,satisfied,
 ${WORKFLOW_STATUS} AS "workflowStatus",reviewed_at AS "reviewedAt",reviewed_by AS "reviewedBy",operated,operated_at AS "operatedAt",
 version,created_at AS "createdAt",updated_at AS "updatedAt",updated_by AS "updatedBy"`;

@Injectable()
export class DirectLedgersService {
  constructor(
    private readonly db: DataSource,
    private readonly notifications: LedgerNotificationsService,
    private readonly toursService: ToursService,
  ) {}
  private access(actor: AuthenticatedUser, action = 'list') {
    requirePermission(actor, `ledger:direct:${action}`);
    if (actor.scope === 'headquarters') {
      if (
        !isFullAdministrator(actor) &&
        action !== 'list' &&
        !(action === 'create' && isLedgerRoot(actor))
      )
        forbidden();
    } else if (!['linxi', 'website'].includes(actor.scope)) forbidden();
  }
  private manageable(row: DirectRow, actor: AuthenticatedUser) {
    return (
      isFullAdministrator(actor) ||
      (actor.scope === row.businessUnit &&
        (isManager(actor) ||
          row.creatorId === actor.id ||
          row.operatorId === actor.id))
    );
  }
  private present(row: DirectRow, actor: AuthenticatedUser) {
    const manage = this.manageable(row, actor);
    const edit =
      manage &&
      !row.reviewedAt &&
      !row.operatedAt &&
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
          (isFullAdministrator(actor) ||
            (actor.scope === row.businessUnit && isManager(actor))) &&
          row.loss &&
          !row.reviewedAt &&
          !row.operated &&
          actor.permissions.includes('ledger:direct:review'),
        canOperate:
          (isFullAdministrator(actor) ||
            (actor.scope === row.businessUnit &&
              actor.id === row.operatorId)) &&
          !row.operated &&
          (!row.loss || Boolean(row.reviewedAt)) &&
          row.proposalSent &&
          row.orderStatus === 'converted' &&
          actor.permissions.includes('ledger:direct:operate'),
        canConvert:
          manage &&
          actor.permissions.includes('ledger:direct:update') &&
          actor.permissions.includes('tour:create') &&
          !row.tours.some((tour) => tour.status === 'active'),
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
  async filterOptions(
    query: DirectFilterOptionsQueryDto,
    actor: AuthenticatedUser,
  ) {
    this.access(actor);
    const params: unknown[] = [];
    let where = `WHERE business_unit=$${params.push(directUnit(actor, query.businessUnit))}`;
    const [idColumn, nameColumn] = {
      creator: ['creator_id', 'creator_name'],
      operator: ['operator_id', 'operator_name'],
    }[query.kind];
    where += ` AND ${idColumn} IS NOT NULL`;
    const snapshots = `SELECT DISTINCT ON (${idColumn}) ${idColumn}::text AS id, ${nameColumn} AS name
      FROM direct_ledgers ${where} ORDER BY ${idColumn}, direct_ledgers.updated_at DESC, direct_ledgers.id DESC`;
    const search = query.keyword?.trim()
      ? `WHERE name ILIKE $${params.push(`%${query.keyword.trim()}%`)}`
      : '';
    const [count] = await this.db.query<{ total: string }[]>(
      `SELECT count(*) AS total FROM (${snapshots}) options ${search}`,
      params,
    );
    const list = await this.db.query<{ id: string; name: string }[]>(
      `SELECT id,name FROM (${snapshots}) options ${search} ORDER BY name,id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.pageSize, (query.page - 1) * query.pageSize],
    );
    return {
      list,
      total: Number(count.total),
      page: query.page,
      pageSize: query.pageSize,
    };
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
    if (query.operatorId)
      where += ` AND operator_id=$${params.push(query.operatorId)}`;
    if (query.workflowStatus)
      where += ` AND (${WORKFLOW_STATUS})=$${params.push(query.workflowStatus)}`;
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
    return this.personnel(query, actor, 'operation');
  }
  async collectors(query: DirectLedgerQueryDto, actor: AuthenticatedUser) {
    return this.personnel(query, actor, 'reception');
  }
  async receivingGroups(query: DirectLedgerQueryDto, actor: AuthenticatedUser) {
    this.access(actor);
    if (directUnit(actor, query.businessUnit) !== 'linxi') forbidden();
    const params: unknown[] = [];
    let where = "WHERE status='enabled'";
    if (query.keyword?.trim())
      where += ` AND name ILIKE $${params.push(`%${query.keyword.trim()}%`)}`;
    const [count] = await this.db.query<{ total: string }[]>(
      `SELECT count(*) AS total FROM business_groups ${where}`,
      params,
    );
    const list = await this.db.query<{ id: string; name: string }[]>(
      `SELECT id,name FROM business_groups ${where} ORDER BY name,id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.pageSize, (query.page - 1) * query.pageSize],
    );
    return {
      list,
      total: Number(count.total),
      page: query.page,
      pageSize: query.pageSize,
    };
  }
  private async personnel(
    query: DirectLedgerQueryDto,
    actor: AuthenticatedUser,
    duty: 'reception' | 'operation',
  ) {
    this.access(actor);
    const unit = directUnit(actor, query.businessUnit);
    const params: unknown[] = [unit, duty];
    let from = COORDINATOR_FROM + " AND i.coordinator_duty IN ($2,'both')";
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
  private async country(
    manager: EntityManager,
    id: string | null,
    existing?: DirectRow,
  ) {
    if (id === null)
      return { country_item_id: null, country_code: null, country_name: null };
    if (existing?.countryItemId === id)
      return {
        country_item_id: id,
        country_code: existing.countryCode,
        country_name: existing.countryName,
      };
    const [country] = await manager.query<{ code: string; name: string }[]>(
      `SELECT i.code,i.name FROM system_business_dictionary_items i JOIN system_business_dictionary_types t ON t.id=i.type_id
       WHERE i.id=$1 AND t.code='country-region' AND t.deleted_at IS NULL AND i.status='enabled' AND i.deleted_at IS NULL FOR SHARE OF i,t`,
      [id],
    );
    if (!country) invalid('请选择有效的国家和地区');
    return {
      country_item_id: id,
      country_code: country.code,
      country_name: country.name,
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
        : await coordinator(manager, input.operatorId, unit, 'operation');
    let account: { name: string };
    if (unit === 'website') {
      if (input.receivingGroupId != null) invalid('独立站接单账号固定为独立站');
      account = { name: '独立站' };
    } else {
      if (!input.receivingGroupId) invalid('请选择霖熹接单业务组');
      account =
        existing?.receivingGroupId === input.receivingGroupId
          ? { name: existing.receivingAccountName }
          : await requireBusinessGroup(manager, input.receivingGroupId);
    }
    return {
      ...(await this.country(manager, input.countryItemId, existing)),
      received_date: input.receivedDate,
      source: input.source,
      receiving_group_id: input.receivingGroupId ?? null,
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
  async create(input: CreateDirectLedgerDto, actor: AuthenticatedUser) {
    this.access(actor, 'create');
    const unit = directUnit(actor, input.businessUnit);
    if (input.orderStatus === 'converted') {
      if (!input.tour) invalid('已成团台账必须填写建团资料');
      requirePermission(actor, 'tour:create');
      if (
        input.countryItemId &&
        input.countryItemId !== input.tour.countryItemId
      )
        invalid('国家和地区与建团资料不一致');
    } else if (input.tour !== undefined) invalid('未成团台账不能提交建团资料');
    const delegate = isLedgerRoot(actor);
    if (!delegate && input.creatorId !== undefined) forbidden();
    if (delegate && !input.creatorId)
      invalid('请选择本业务的启用计调作为收客计调');
    return this.db.transaction(async (manager) => {
      const creator = delegate
        ? await coordinator(manager, input.creatorId!, unit)
        : await coordinator(manager, actor.id, unit, 'reception');
      const data = {
        ...(await this.values(
          manager,
          {
            ...input,
            countryItemId: input.tour?.countryItemId ?? input.countryItemId,
          },
          unit,
        )),
        business_unit: unit,
        creator_id: creator.id,
        creator_name: creator.name,
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
      if (input.tour) await this.createTour(manager, row, input.tour, actor);
      await this.notifications.enqueue(manager, row);
      return this.present(
        input.tour ? await this.row(manager, row.id, actor) : row,
        actor,
      );
    });
  }
  private async createTour(
    manager: EntityManager,
    row: DirectRow,
    input: DirectLedgerTourDto,
    actor: AuthenticatedUser,
  ) {
    if (row.countryItemId && row.countryItemId !== input.countryItemId)
      invalid('成团国家和地区须与台账一致');
    const country = await this.country(manager, input.countryItemId, row);
    // Existing snapshots are accepted, but the selected country must still be usable for a new tour.
    const [valid] = await manager.query<{ id: string }[]>(
      `SELECT i.id FROM system_business_dictionary_items i JOIN system_business_dictionary_types t ON t.id=i.type_id
       WHERE i.id=$1 AND t.code='country-region' AND t.deleted_at IS NULL AND i.status='enabled' AND i.deleted_at IS NULL FOR SHARE OF i,t`,
      [input.countryItemId],
    );
    if (!valid) invalid('请选择有效的国家和地区');
    await this.toursService.createFromLedger(
      manager,
      input,
      {
        ...row,
        countryItemId: country.country_item_id!,
        countryCode: country.country_code!,
        countryName: country.country_name!,
      },
      actor,
    );
    return country;
  }

  async convert(
    id: string,
    input: ConvertDirectLedgerDto,
    actor: AuthenticatedUser,
  ) {
    this.access(actor, 'update');
    requirePermission(actor, 'tour:create');
    return this.db.transaction(async (manager) => {
      const row = await this.row(manager, id, actor, true);
      if (!this.manageable(row, actor)) forbidden();
      assertVersion(row.version, input.version);
      if (row.tours.some((tour) => tour.status === 'active'))
        conflict(ErrorCode.CONFLICT, '台账已有有效旅行团');
      const country = await this.createTour(manager, row, input.tour, actor);
      const [[saved]] = await manager.query<[DirectRow[], number]>(
        `UPDATE direct_ledgers SET country_item_id=$2,country_code=$3,country_name=$4,order_status='converted',
          version=version+1,updated_at=now(),updated_by=$5 WHERE id=$1 RETURNING ${SELECT}`,
        [
          id,
          country.country_item_id,
          country.country_code,
          country.country_name,
          actor.id,
        ],
      );
      if (
        row.orderStatus === 'unconverted' &&
        !row.operatedAt &&
        !row.operated &&
        row.tours.length === 0
      )
        await this.notifications.enqueue(manager, saved, row);
      return this.present(saved, actor);
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
      if (row.reviewedAt)
        conflict(
          ErrorCode.DIRECT_LEDGER_REVIEWED_READ_ONLY,
          '已确认台账不能修改普通字段',
        );
      if (row.operatedAt)
        conflict(
          ErrorCode.DIRECT_LEDGER_OPERATED_READ_ONLY,
          '已操作台账不能修改普通字段',
        );
      if (row.orderStatus !== input.orderStatus)
        invalid('请使用成团操作修改订单状态');
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
      await this.notifications.enqueue(manager, saved, row);
      return this.present(saved, actor);
    });
  }
  async review(id: string, version: number, actor: AuthenticatedUser) {
    this.access(actor, 'review');
    if (!isManager(actor) && !isFullAdministrator(actor)) forbidden();
    return this.db.transaction(async (manager) => {
      const row = await this.row(manager, id, actor, true);
      assertVersion(row.version, version);
      if (!row.loss || row.reviewedAt || row.operated)
        conflict(
          ErrorCode.DIRECT_LEDGER_NOT_PENDING_CONFIRMATION,
          '仅待确认的亏损台账需要负责人确认',
        );
      const [[saved]] = await manager.query<[DirectRow[], number]>(
        `UPDATE direct_ledgers SET reviewed_at=now(),reviewed_by=$2,updated_by=$2,updated_at=now(),version=version+1 WHERE id=$1 RETURNING ${SELECT}`,
        [id, actor.id],
      );
      await this.notifications.enqueue(manager, saved, row);
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
      if (row.operatorId !== actor.id && !isFullAdministrator(actor))
        forbidden();
      assertVersion(row.version, input.version);
      if (row.operated || (row.loss && !row.reviewedAt))
        conflict(
          ErrorCode.DIRECT_LEDGER_NOT_PENDING_OPERATION,
          '仅待操作的台账可以标记已操作',
        );
      if (!row.proposalSent || row.orderStatus !== 'converted')
        conflict(
          ErrorCode.DIRECT_LEDGER_OPERATION_PREREQUISITES_NOT_MET,
          '台账须已发送方案且已成团，才能标记已操作',
        );
      const [[saved]] = await manager.query<[DirectRow[], number]>(
        `UPDATE direct_ledgers SET operated=true,operated_at=coalesce(operated_at,now()),updated_by=$2,updated_at=now(),version=version+1 WHERE id=$1 RETURNING ${SELECT}`,
        [id, actor.id],
      );
      await this.notifications.enqueue(manager, saved, row);
      return this.present(saved, actor);
    });
  }
  async delete(id: string, version: number, actor: AuthenticatedUser) {
    this.access(actor, 'delete');
    await this.db.transaction(async (manager) => {
      const row = await this.row(manager, id, actor, true);
      if (!this.manageable(row, actor)) forbidden();
      assertVersion(row.version, version);
      if (row.reviewedAt)
        conflict(ErrorCode.DIRECT_LEDGER_DELETE_REVIEWED, '已确认台账不能删除');
      if (row.operatedAt)
        conflict(
          ErrorCode.DIRECT_LEDGER_DELETE_OPERATED,
          '曾操作的台账不能删除',
        );
      if (row.orderStatus === 'converted')
        conflict(
          ErrorCode.DIRECT_LEDGER_DELETE_CONVERTED,
          '已成团台账不能删除',
        );
      await manager.query('DELETE FROM direct_ledgers WHERE id=$1', [id]);
    });
  }
}
