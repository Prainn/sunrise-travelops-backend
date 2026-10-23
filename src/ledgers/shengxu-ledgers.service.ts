import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { ErrorCode } from '../common/constants/error-code';
import { AuthenticatedUser } from '../auth/auth.types';
import {
  AgencyOptionsQueryDto,
  ShengxuFilterOptionsQueryDto,
  ShengxuLedgerQueryDto,
  ShengxuLedgerInputDto,
  UpdateShengxuLedgerDto,
} from './ledger.dto';
import {
  assertVersion,
  COORDINATOR_FROM,
  coordinator,
  conflict,
  forbidden,
  invalid,
  isManager,
  isLedgerRoot,
  missing,
  requirePermission,
} from './ledger-access';

interface ShengxuRow {
  id: string;
  creatorId: string;
  creatorName: string;
  coordinatorId?: string;
  recordDate: string;
  agencyId: string;
  agencyName: string;
  contactId: string;
  contactName: string;
  countryOrRegion: string;
  city: string;
  convertedGroups: number;
  version: number;
}
const SELECT = `id, 'shengxu' AS "businessUnit", record_date::text AS "recordDate",
 creator_id AS "creatorId",creator_name AS "creatorName",agency_id AS "agencyId",agency_name AS "agencyName",
 country_or_region AS "countryOrRegion",city,contact_id AS "contactId",contact_name AS "contactName",
 quoted_groups AS "quotedGroups",converted_groups AS "convertedGroups",quote_sent AS "quoteSent",
 itinerary,not_converted_reason AS "notConvertedReason",version,created_at AS "createdAt",updated_at AS "updatedAt",updated_by AS "updatedBy"`;

@Injectable()
export class ShengxuLedgersService {
  constructor(private readonly db: DataSource) {}
  private access(actor: AuthenticatedUser, action = 'list') {
    requirePermission(actor, `ledger:shengxu:${action}`);
    if (
      actor.scope !== 'shengxu' &&
      !(
        actor.scope === 'headquarters' &&
        (action === 'list' || (action === 'create' && isLedgerRoot(actor)))
      )
    )
      forbidden();
  }
  private manageable(row: ShengxuRow, actor: AuthenticatedUser) {
    return (
      actor.scope === 'shengxu' &&
      (row.creatorId === actor.id || isManager(actor))
    );
  }
  private present(row: ShengxuRow, actor: AuthenticatedUser) {
    const manage = this.manageable(row, actor);
    return {
      ...row,
      capabilities: {
        canEdit: manage && actor.permissions.includes('ledger:shengxu:update'),
        canDelete:
          manage &&
          row.convertedGroups === 0 &&
          actor.permissions.includes('ledger:shengxu:delete'),
      },
    };
  }
  private async row(manager: EntityManager, id: string, lock = false) {
    const [row] = await manager.query<ShengxuRow[]>(
      `SELECT ${SELECT} FROM shengxu_ledgers WHERE id=$1${lock ? ' FOR UPDATE' : ''}`,
      [id],
    );
    return row ?? missing();
  }
  async filterOptions(
    query: ShengxuFilterOptionsQueryDto,
    actor: AuthenticatedUser,
  ) {
    this.access(actor);
    const params: unknown[] = [];
    let where = 'WHERE true';
    const [idColumn, nameColumn] = {
      creator: ['creator_id', 'creator_name'],
      agency: ['agency_id', 'agency_name'],
    }[query.kind];
    where += ` AND ${idColumn} IS NOT NULL`;
    const snapshots = `SELECT DISTINCT ON (${idColumn}) ${idColumn}::text AS id, ${nameColumn} AS name
      FROM shengxu_ledgers ${where} ORDER BY ${idColumn}, shengxu_ledgers.updated_at DESC, shengxu_ledgers.id DESC`;
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

  async list(query: ShengxuLedgerQueryDto, actor: AuthenticatedUser) {
    this.access(actor);
    if (query.from && query.to && query.from > query.to)
      invalid('开始日期不能晚于结束日期');
    const params: unknown[] = [];
    let where = 'WHERE true';
    if (query.from) where += ` AND record_date >= $${params.push(query.from)}`;
    if (query.to) where += ` AND record_date <= $${params.push(query.to)}`;
    if (query.creatorId)
      where += ` AND creator_id = $${params.push(query.creatorId)}`;
    if (query.agencyId)
      where += ` AND agency_id=$${params.push(query.agencyId)}`;
    if (query.keyword?.trim()) {
      const p = `$${params.push(`%${query.keyword.trim()}%`)}`;
      where += ` AND (agency_name ILIKE ${p} OR contact_name ILIKE ${p} OR creator_name ILIKE ${p} OR itinerary ILIKE ${p})`;
    }
    const [count] = await this.db.query<{ total: string }[]>(
      `SELECT count(*) AS total FROM shengxu_ledgers ${where}`,
      params,
    );
    const rows = await this.db.query<ShengxuRow[]>(
      `SELECT ${SELECT} FROM shengxu_ledgers ${where} ORDER BY record_date DESC,created_at DESC,id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.pageSize, (query.page - 1) * query.pageSize],
    );
    return {
      list: rows.map((row) => this.present(row, actor)),
      total: Number(count.total),
      page: query.page,
      pageSize: query.pageSize,
    };
  }
  async get(id: string, actor: AuthenticatedUser) {
    this.access(actor);
    return this.present(await this.row(this.db.manager, id), actor);
  }
  async agencies(query: AgencyOptionsQueryDto, actor: AuthenticatedUser) {
    this.access(actor);
    requirePermission(actor, 'resource:agency:list');
    if (actor.scope === 'headquarters' && !isLedgerRoot(actor)) forbidden();
    let owner = actor.id;
    if (query.ledgerId) {
      const row = await this.row(this.db.manager, query.ledgerId);
      if (!this.manageable(row, actor)) forbidden();
      owner = row.creatorId;
    }
    const delegate = isLedgerRoot(actor);
    const params: unknown[] = [delegate ? 'shengxu' : owner];
    let where = `WHERE business_unit='shengxu' AND status='enabled' AND deleted_at IS NULL AND ${
      delegate
        ? `EXISTS (SELECT 1 ${COORDINATOR_FROM} AND u.id=resource_agencies.coordinator_id)`
        : 'coordinator_id=$1'
    }`;
    if (query.keyword?.trim())
      where += ` AND name ILIKE $${params.push(`%${query.keyword.trim()}%`)}`;
    const [count] = await this.db.query<{ total: string }[]>(
      `SELECT count(*) AS total FROM resource_agencies ${where}`,
      params,
    );
    const list = await this.db.query<Record<string, unknown>[]>(
      `SELECT id,name,city,country_or_region AS "countryOrRegion"${delegate ? ',coordinator_id AS "coordinatorId",(SELECT nickname FROM users WHERE id=coordinator_id) AS "coordinatorName"' : ''} FROM resource_agencies ${where} ORDER BY name,id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.pageSize, (query.page - 1) * query.pageSize],
    );
    return {
      list,
      total: Number(count.total),
      page: query.page,
      pageSize: query.pageSize,
    };
  }
  async contacts(
    agencyId: string,
    query: AgencyOptionsQueryDto,
    actor: AuthenticatedUser,
  ) {
    this.access(actor);
    requirePermission(actor, 'resource:agency:list');
    if (actor.scope === 'headquarters' && !isLedgerRoot(actor)) forbidden();
    const existing = query.ledgerId
      ? await this.row(this.db.manager, query.ledgerId)
      : undefined;
    if (existing && !this.manageable(existing, actor)) forbidden();
    const owner = isLedgerRoot(actor)
      ? null
      : (existing?.creatorId ?? actor.id);
    if (existing?.agencyId !== agencyId) {
      const rows = await this.db.query<{ id: string }[]>(
        `SELECT id FROM resource_agencies WHERE id=$1 AND ($2::uuid IS NULL OR coordinator_id=$2) AND business_unit='shengxu' AND status='enabled' AND deleted_at IS NULL`,
        [agencyId, owner],
      );
      if (!rows.length) invalid('请选择关联计调的启用盛旭组团社');
    }
    const params: unknown[] = [agencyId];
    let where = 'WHERE agency_id=$1 AND deleted_at IS NULL';
    if (query.keyword?.trim())
      where += ` AND name ILIKE $${params.push(`%${query.keyword.trim()}%`)}`;
    const [count] = await this.db.query<{ total: string }[]>(
      `SELECT count(*) AS total FROM resource_agency_contacts ${where}`,
      params,
    );
    const list = await this.db.query<Record<string, unknown>[]>(
      `SELECT id,name,phone FROM resource_agency_contacts ${where} ORDER BY name,id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.pageSize, (query.page - 1) * query.pageSize],
    );
    return {
      list,
      total: Number(count.total),
      page: query.page,
      pageSize: query.pageSize,
    };
  }
  private async resources(
    manager: EntityManager,
    input: ShengxuLedgerInputDto,
    owner: string | null,
    existing?: ShengxuRow,
  ) {
    let agency = existing;
    if (!existing || existing.agencyId !== input.agencyId) {
      [agency] = await manager.query<ShengxuRow[]>(
        `SELECT name AS "agencyName",country_or_region AS "countryOrRegion",city,coordinator_id AS "coordinatorId" FROM resource_agencies WHERE id=$1 AND ($2::uuid IS NULL OR coordinator_id=$2) AND business_unit='shengxu' AND status='enabled' AND deleted_at IS NULL FOR SHARE`,
        [input.agencyId, owner],
      );
      if (!agency) invalid('请选择关联计调的启用盛旭组团社');
    }
    let contactName = existing?.contactName;
    if (
      !existing ||
      existing.agencyId !== input.agencyId ||
      existing.contactId !== input.contactId
    ) {
      const [contact] = await manager.query<{ name: string }[]>(
        `SELECT name FROM resource_agency_contacts WHERE id=$1 AND agency_id=$2 AND deleted_at IS NULL FOR SHARE`,
        [input.contactId, input.agencyId],
      );
      if (!contact) invalid('请选择该组团社的有效联系人');
      contactName = contact.name;
    }
    if (!agency) invalid('请选择有效组团社');
    return {
      coordinatorId: agency.coordinatorId,
      snapshots: [
        agency.agencyName,
        agency.countryOrRegion,
        agency.city,
        contactName,
      ],
    };
  }
  private duplicate(error: unknown): never {
    if (
      error instanceof QueryFailedError &&
      (error.driverError as { constraint?: string }).constraint ===
        'uq_shengxu_ledger_date_agency'
    )
      conflict(
        ErrorCode.SHENGXU_LEDGER_DUPLICATE,
        '当天该组团社已有台账，请修改已有记录',
      );
    throw error;
  }
  async create(input: ShengxuLedgerInputDto, actor: AuthenticatedUser) {
    this.access(actor, 'create');
    requirePermission(actor, 'resource:agency:list');
    try {
      return await this.db.transaction(async (manager) => {
        const delegate = isLedgerRoot(actor);
        const resources = await this.resources(
          manager,
          input,
          delegate ? null : actor.id,
        );
        if (delegate && !resources.coordinatorId)
          invalid('请选择关联启用盛旭计调的组团社');
        const creator = delegate
          ? await coordinator(manager, resources.coordinatorId!, 'shengxu')
          : await coordinator(manager, actor.id, 'shengxu');
        const [row] = await manager.query<ShengxuRow[]>(
          `INSERT INTO shengxu_ledgers(record_date,creator_id,creator_name,agency_id,contact_id,agency_name,country_or_region,city,contact_name,quoted_groups,converted_groups,quote_sent,itinerary,not_converted_reason,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING ${SELECT}`,
          [
            input.recordDate,
            creator.id,
            creator.name,
            input.agencyId,
            input.contactId,
            ...resources.snapshots,
            input.quotedGroups,
            input.convertedGroups,
            input.quoteSent,
            input.itinerary,
            input.notConvertedReason,
            actor.id,
          ],
        );
        return this.present(row, actor);
      });
    } catch (error) {
      this.duplicate(error);
    }
  }
  async update(
    id: string,
    input: UpdateShengxuLedgerDto,
    actor: AuthenticatedUser,
  ) {
    this.access(actor, 'update');
    requirePermission(actor, 'resource:agency:list');
    try {
      return await this.db.transaction(async (manager) => {
        const row = await this.row(manager, id, true);
        if (!this.manageable(row, actor)) forbidden();
        assertVersion(row.version, input.version);
        const resources = await this.resources(
          manager,
          input,
          row.creatorId,
          row,
        );
        const [[saved]] = await manager.query<[ShengxuRow[], number]>(
          `UPDATE shengxu_ledgers SET record_date=$2,agency_id=$3,contact_id=$4,agency_name=$5,country_or_region=$6,city=$7,contact_name=$8,quoted_groups=$9,converted_groups=$10,quote_sent=$11,itinerary=$12,not_converted_reason=$13,updated_by=$14,updated_at=now(),version=version+1 WHERE id=$1 RETURNING ${SELECT}`,
          [
            id,
            input.recordDate,
            input.agencyId,
            input.contactId,
            ...resources.snapshots,
            input.quotedGroups,
            input.convertedGroups,
            input.quoteSent,
            input.itinerary,
            input.notConvertedReason,
            actor.id,
          ],
        );
        return this.present(saved, actor);
      });
    } catch (error) {
      this.duplicate(error);
    }
  }
  async delete(id: string, version: number, actor: AuthenticatedUser) {
    this.access(actor, 'delete');
    await this.db.transaction(async (manager) => {
      const row = await this.row(manager, id, true);
      if (!this.manageable(row, actor)) forbidden();
      assertVersion(row.version, version);
      if (row.convertedGroups > 0)
        conflict(
          ErrorCode.SHENGXU_LEDGER_DELETE_CONVERTED,
          '成团数大于零的台账不能删除',
        );
      await manager.query('DELETE FROM shengxu_ledgers WHERE id=$1', [id]);
    });
  }
}
