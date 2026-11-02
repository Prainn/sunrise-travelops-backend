/** Real HTTP/guards/transactions; only IsolationHarness's fresh local PostgreSQL database. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { plainToInstance } from 'class-transformer';
import { ConfigService } from '@nestjs/config';
import { IsolationHarness, RecordRef } from './business-isolation.harness';
import { LinkDirectLedgerTours1795305600000 } from '../src/migrations/1795305600000-LinkDirectLedgerTours';
import { DirectLedgersService } from '../src/ledgers/direct-ledgers.service';
import { LedgerNotificationsService } from '../src/ledgers/ledger-notifications.service';
import { FeishuService } from '../src/feishu/feishu.service';
import { ToursService } from '../src/tours/tours.service';
import { AuthenticatedUser } from '../src/auth/auth.types';
import { effectivePermissions } from '../src/auth/identity-permissions';
import {
  ConvertDirectLedgerDto,
  CreateDirectLedgerDto,
} from '../src/ledgers/ledger.dto';

type Ledger = RecordRef & {
  countryItemId: string | null;
  countryCode: string | null;
  countryName: string | null;
  orderStatus: string;
  reviewedAt: string | null;
  operatedAt: string | null;
  operated: boolean;
  creatorId: string;
  operatorId: string;
  proposalSent: boolean;
  tours: Array<
    RecordRef & { tourNo: string; status: string; cancelReason: string }
  >;
  capabilities: { canConvert: boolean; canEdit: boolean; canOperate: boolean };
};
const h = new IsolationHarness();
let checks = 0;
function pass(label: string) {
  console.log(`PASS ${++checks}: ${label}`);
}
async function main() {
  const directory = resolve(__dirname, '../src/migrations');
  h.db.setOptions({
    migrations: readdirSync(directory)
      .filter(
        (name) =>
          name.endsWith('.ts') && !name.includes('LinkDirectLedgerTours'),
      )
      .map((name) => resolve(directory, name)),
  });
  try {
    await h.start();
    const oldUser = randomUUID();
    await h.db.query<Record<string, unknown>[]>(
      "INSERT INTO users(id,username,nickname,english_name,password_hash) VALUES($1,'ledger_old','Old','Old','fixture')",
      [oldUser],
    );
    const [old] = await h.db.query<{ id: string; order_no: string }[]>(
      `INSERT INTO direct_ledgers(business_unit,received_date,source,creator_id,creator_name,operator_id,operator_name,receiving_account_name,updated_by,order_status,operated,operated_at)
      VALUES('website','2026-10-01','Old',$1,'Old collector',$1,'Old operator','独立站',$1,'converted',true,now()) RETURNING id,order_no`,
      [oldUser],
    );
    const before = await h.db.query<Record<string, unknown>[]>(
      'SELECT * FROM direct_ledgers WHERE id=$1',
      [old.id],
    );
    h.db.migrations.push(new LinkDirectLedgerTours1795305600000());
    assert.equal((await h.db.runMigrations()).length, 1);
    assert.equal((await h.db.runMigrations()).length, 0);
    const after = await h.db.query<Record<string, unknown>[]>(
      'SELECT * FROM direct_ledgers WHERE id=$1',
      [old.id],
    );
    assert.deepEqual(after, [
      {
        ...before[0],
        country_item_id: null,
        country_code: null,
        country_name: null,
      },
    ]);
    pass('旧结构/已操作旧台账升级保留全部原字段，重复迁移无操作');
    const root = await h.actor('headquarters', 'ROOT');
    const admin = await h.actor('headquarters', 'ADMIN');
    const executive = await h.actor('headquarters', 'EXECUTIVE');
    const [country] = await h.db.query<
      { id: string }[]
    >(`INSERT INTO system_business_dictionary_items(type_id,code,name,english_name)
      SELECT id,'LEDGER-REGION','测试国家','Test region' FROM system_business_dictionary_types WHERE code='country-region' RETURNING id`);
    const [{ id: group }] = await h.db.query<{ id: string }[]>(
      'SELECT id FROM business_groups LIMIT 1',
    );
    for (const unit of ['linxi', 'website'] as const) {
      const collector = await h.actor(unit, 'COORDINATOR', 'reception');
      const operator = await h.actor(unit, 'COORDINATOR', 'operation');
      const unrelated = await h.actor(unit);
      const manager = await h.actor(unit, 'BUSINESS_MANAGER');
      const resource = await h.actor(unit, 'RESOURCE_MANAGER');
      const otherBusiness = await h.actor(
        unit === 'website' ? 'linxi' : 'website',
      );
      const base = {
        businessUnit: unit,
        receivedDate: '2026-11-02',
        source: '客户或携程单号',
        receivingGroupId: unit === 'linxi' ? group : null,
        operatorId: operator.id,
        proposalSent: true,
      };
      const tour = {
        countryItemId: country.id,
        startDate: '2026-11-05',
        days: 2,
        itinerarySummary: '昆明',
        adults: 2,
        children: 0,
        leaders: 0,
        shopping: false,
        guideServices: [],
        scheduleMode: 'manual',
        pickupAt: '2026-11-05 09:00',
        dropAt: '2026-11-06 18:00',
      };
      const create = (overrides = {}) =>
        h.call<Ledger>(
          collector,
          'POST',
          '/ledgers/direct',
          { ...base, ...overrides },
          201,
        );
      let row = await create();
      assert.equal(row.countryItemId, null);
      assert.equal(row.tours.length, 0);
      assert.equal(row.capabilities.canConvert, true);
      await h.call(
        collector,
        'POST',
        '/ledgers/direct',
        { ...base, orderStatus: 'converted' },
        400,
        'VALIDATION_ERROR',
      );
      await h.call(
        collector,
        'POST',
        '/ledgers/direct',
        {
          ...base,
          orderStatus: 'converted',
          tour: { ...tour, countryItemId: undefined },
        },
        400,
        'VALIDATION_ERROR',
      );
      await h.call(
        collector,
        'POST',
        '/ledgers/direct',
        { ...base, tour },
        400,
        'VALIDATION_ERROR',
      );
      await h.call(
        collector,
        'POST',
        '/ledgers/direct',
        {
          ...base,
          orderStatus: 'converted',
          tour: { ...tour, operatorId: unrelated.id },
        },
        400,
        'VALIDATION_ERROR',
      );
      await h.call(
        collector,
        'PUT',
        `/ledgers/direct/${row.id}`,
        {
          ...base,
          businessUnit: undefined,
          orderStatus: 'converted',
          version: row.version,
        },
        400,
        'VALIDATION_ERROR',
      );
      pass(`${unit} 国家可空，已成团资料必填，拒绝人员覆盖及普通编辑改状态`);
      const delegated = await h.call<Ledger>(
        root,
        'POST',
        '/ledgers/direct',
        {
          ...base,
          creatorId: collector.id,
          orderStatus: 'converted',
          tour,
        },
        201,
      );
      assert.equal(delegated.creatorId, collector.id);
      assert.equal(delegated.operatorId, operator.id);
      assert.equal(delegated.tours.length, 1);
      const populated = await create({ countryItemId: country.id });
      await h.call(
        operator,
        'POST',
        `/ledgers/direct/${populated.id}/convert`,
        {
          version: populated.version,
          tour: { ...tour, countryItemId: randomUUID() },
        },
        400,
        'VALIDATION_ERROR',
      );
      const created = await create({ orderStatus: 'converted', tour });
      assert.equal(created.tours.length, 1);
      assert.equal(created.countryItemId, country.id);
      const createdTour = await h.call<
        RecordRef & {
          creatorId: string;
          collectCoordinatorId: string;
          operatorId: string;
          directLedgerId: string;
          directLedgerOrderNo: string;
          canEdit: boolean;
          canCancel: boolean;
        }
      >(operator, 'GET', `/tours/${created.tours[0].id}`);
      assert.equal(createdTour.directLedgerId, created.id);
      assert.equal(createdTour.creatorId, collector.id);
      assert.equal(createdTour.collectCoordinatorId, collector.id);
      assert.equal(createdTour.operatorId, operator.id);
      assert.equal(createdTour.canEdit, true);
      assert.equal(createdTour.canCancel, false);
      await h.call(
        operator,
        'POST',
        `/tours/${createdTour.id}/cancel`,
        { version: 1, reason: '取消' },
        403,
        'AUTH_FORBIDDEN',
      );
      pass(`${unit} 已成团新增原子生成团，继承台账人员，计调不能撤销`);
      for (const actor of [unrelated, root, admin, executive, resource])
        await h.call(
          actor,
          'POST',
          `/ledgers/direct/${row.id}/convert`,
          { version: row.version, tour },
          403,
          'AUTH_FORBIDDEN',
        );
      await h.call(
        otherBusiness,
        'POST',
        `/ledgers/direct/${row.id}/convert`,
        { version: row.version, tour },
        404,
        'NOT_FOUND',
      );
      row = await h.call<Ledger>(
        operator,
        'POST',
        `/ledgers/direct/${row.id}/convert`,
        { version: row.version, tour },
      );
      assert.equal(row.orderStatus, 'converted');
      assert.equal(row.capabilities.canConvert, false);
      await h.call(
        operator,
        'POST',
        `/ledgers/direct/${row.id}/convert`,
        { version: row.version, tour },
        409,
        'CONFLICT',
      );
      await h.call(
        operator,
        'POST',
        `/ledgers/direct/${row.id}/convert`,
        { version: 1, tour },
        409,
        'LEDGER_VERSION_CONFLICT',
      );
      pass(`${unit} 指定操作计调可成团，未关联/只读/跨业务/重复/旧版本拒绝`);
      // Real concurrent row locks: one commit, one version conflict, exactly one active tour.
      let concurrent = await create();
      const actor: AuthenticatedUser = {
        id: operator.id,
        identityId: operator.identityId,
        username: 'fixture',
        nickname: 'fixture',
        scope: unit,
        scopeName: '',
        deptId: null,
        deptName: '',
        menuKeys: [],
        roles: ['COORDINATOR'],
        permissions: effectivePermissions(unit, ['COORDINATOR'], 'operation'),
      };
      const sender = new FeishuService(
        new ConfigService({
          FEISHU_APP_ID: 'fixture',
          FEISHU_APP_SECRET: 'fixture',
          FEISHU_WEB_BASE_URL: 'https://example.test',
        }),
      );
      sender.sendText = () => {
        throw new Error('test must never contact Feishu');
      };
      const notifications = new LedgerNotificationsService(h.db, sender);
      const service = new DirectLedgersService(
        h.db,
        notifications,
        new ToursService(h.db),
      );
      const results = await Promise.allSettled([
        service.convert(
          concurrent.id,
          plainToInstance(ConvertDirectLedgerDto, {
            version: concurrent.version,
            tour,
          }),
          actor,
        ),
        service.convert(
          concurrent.id,
          plainToInstance(ConvertDirectLedgerDto, {
            version: concurrent.version,
            tour,
          }),
          actor,
        ),
      ]);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      const rejected = results.find(
        (r) => r.status === 'rejected',
      ) as PromiseRejectedResult;
      assert.equal(
        (rejected.reason as { code: string }).code,
        'LEDGER_VERSION_CONFLICT',
      );
      concurrent = await h.call<Ledger>(
        operator,
        'GET',
        `/ledgers/direct/${concurrent.id}`,
      );
      assert.equal(concurrent.tours.length, 1);
      // Failure after a queued task must roll back the ledger, tour, numbering and queue together.
      await h.db.query<Record<string, unknown>[]>(
        "UPDATE users SET feishu_open_id='ou_ledger_fixture' WHERE id=$1",
        [operator.id],
      );
      const rollbackNotifications = new LedgerNotificationsService(
        h.db,
        sender,
      );
      const enqueue = rollbackNotifications.enqueue.bind(rollbackNotifications);
      rollbackNotifications.enqueue = async (...args) => {
        await enqueue(...args);
        throw new Error('after enqueue rollback');
      };
      const rollbackService = new DirectLedgersService(
        h.db,
        rollbackNotifications,
        new ToursService(h.db),
      );
      const collectorActor = {
        ...actor,
        id: collector.id,
        identityId: collector.identityId,
        permissions: effectivePermissions(unit, ['COORDINATOR'], 'reception'),
      };
      const snapshot = () =>
        h.db.query<Record<string, unknown>[]>(
          `SELECT (SELECT count(*) FROM direct_ledgers)::int AS ledgers,(SELECT count(*) FROM tours)::int AS tours,(SELECT count(*) FROM feishu_ledger_notifications)::int AS jobs,(SELECT coalesce(sum(last_value),0)::int FROM tour_number_counters) AS counters`,
        );
      const snapshotBefore = await snapshot();
      await assert.rejects(
        rollbackService.create(
          plainToInstance(CreateDirectLedgerDto, {
            ...base,
            orderStatus: 'converted',
            tour,
          }),
          collectorActor,
        ),
        /after enqueue rollback/,
      );
      assert.deepEqual(await snapshot(), snapshotBefore);
      pass(`${unit} 并发只生成一个团，队列写后失败完整回滚台账/团/编号/通知`);
      // Conversion queues once; supplements and recreation must never enqueue another operation reminder.
      let notify = await create();
      const originalVersion = notify.version;
      notify = (await service.convert(
        notify.id,
        plainToInstance(ConvertDirectLedgerDto, {
          version: notify.version,
          tour,
        }),
        actor,
      )) as unknown as Ledger;
      const jobs = () =>
        h.db.query<Record<string, unknown>[]>(
          'SELECT id,kind,status FROM feishu_ledger_notifications WHERE ledger_id=$1 ORDER BY id',
          [notify.id],
        );
      assert.equal((await jobs()).length, 1);
      assert.equal((await jobs())[0].kind, 'operate');
      await h.call(
        manager,
        'POST',
        `/tours/${notify.tours[0].id}/cancel`,
        {
          version: 1,
          reason: '  客人取消  ',
        },
        201,
      );
      const cancelled = await h.call<Ledger>(
        operator,
        'GET',
        `/ledgers/direct/${notify.id}`,
      );
      assert.equal(cancelled.orderStatus, 'converted');
      assert.equal(cancelled.tours[0].cancelReason, '客人取消');
      assert.equal(cancelled.version, originalVersion + 1);
      await h.call(
        manager,
        'POST',
        `/tours/${createdTour.id}/cancel`,
        { version: 1, reason: '   ' },
        400,
        'VALIDATION_ERROR',
      );
      await service.convert(
        notify.id,
        plainToInstance(ConvertDirectLedgerDto, {
          version: cancelled.version,
          tour,
        }),
        actor,
      );
      assert.equal((await jobs()).length, 1);
      pass(
        `${unit} 新成团产生操作待办，撤销必填原因且不回退台账，再建不重复提醒`,
      );
      // A reviewed but unconverted ledger keeps every protected field while supplementing.
      let locked = await create({ loss: true });
      locked = await h.call<Ledger>(
        manager,
        'POST',
        `/ledgers/direct/${locked.id}/review`,
        { version: locked.version },
      );
      const lockedBefore = await h.db.query<Record<string, unknown>[]>(
        'SELECT * FROM direct_ledgers WHERE id=$1',
        [locked.id],
      );
      locked = await h.call<Ledger>(
        operator,
        'POST',
        `/ledgers/direct/${locked.id}/convert`,
        { version: locked.version, tour },
      );
      const lockedAfter = await h.db.query<Record<string, unknown>[]>(
        'SELECT * FROM direct_ledgers WHERE id=$1',
        [locked.id],
      );
      for (const field of [
        'creator_id',
        'creator_name',
        'operator_id',
        'operator_name',
        'reviewed_at',
        'reviewed_by',
        'operated',
        'operated_at',
        'departure_date',
        'proposal_sent',
        'loss',
        'loss_note',
      ])
        assert.deepEqual(lockedAfter[0][field], lockedBefore[0][field], field);
      assert.equal(locked.capabilities.canEdit, false);
      // Historical operated snapshot survives a disabled source person and no reminder is created.
      let historical = await create();
      await h.db.query<Record<string, unknown>[]>(
        "UPDATE direct_ledgers SET operated=true,operated_at=now(),order_status='converted',creator_name='旧收客快照',operator_name='旧操作快照' WHERE id=$1",
        [historical.id],
      );
      await h.db.query<Record<string, unknown>[]>(
        "UPDATE users SET status='disabled' WHERE id=$1",
        [operator.id],
      );
      historical = await h.call<Ledger>(
        manager,
        'POST',
        `/ledgers/direct/${historical.id}/convert`,
        { version: historical.version, tour },
      );
      const snapshots = await h.call<
        RecordRef & { collectCoordinatorName: string; operatorName: string }
      >(manager, 'GET', `/tours/${historical.tours[0].id}`);
      assert.equal(snapshots.collectCoordinatorName, '旧收客快照');
      assert.equal(snapshots.operatorName, '旧操作快照');
      assert.equal(historical.operated, true);
      assert.equal(
        (
          await h.db.query<{ id: string }[]>(
            'SELECT id FROM feishu_ledger_notifications WHERE ledger_id=$1',
            [historical.id],
          )
        ).length,
        0,
      );
      await h.db.query<Record<string, unknown>[]>(
        "UPDATE users SET status='enabled' WHERE id=$1",
        [operator.id],
      );
      pass(
        `${unit} 已确认专门成团保留字段锁，已操作补建保留人员/时间快照且不提醒`,
      );
    }
    // Database protection remains effective even for writes outside the HTTP layer.
    await assert.rejects(
      h.db.query<Record<string, unknown>[]>(
        "UPDATE tours SET business_unit='shengxu' WHERE direct_ledger_id IS NOT NULL",
      ),
    );
    await assert.rejects(
      h.db.query<Record<string, unknown>[]>(
        'DELETE FROM system_business_dictionary_items WHERE id=$1',
        [country.id],
      ),
    );
    pass('数据库阻止跨业务台账引用及删除被引用国家');
    console.log(
      `Completed ${checks} groups, ${h.requests} real HTTP requests; no external messages.`,
    );
  } finally {
    await h.close();
  }
}
main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
