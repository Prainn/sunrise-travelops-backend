import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  Actor,
  IsolationHarness,
  Page,
  RecordRef,
} from './business-isolation.harness';
import { BusinessUnit } from '../src/users/user-identity.entity';

const h = new IsolationHarness();
type Option = { id: string; name: string };
type Inquiry = RecordRef & { code: string; ownerId: string };
type Ledger = RecordRef & { capabilities: { canEdit: boolean } };
interface Business {
  unit: BusinessUnit;
  a: Actor;
  b: Actor;
  manager: Actor;
  resource: Actor;
  agencies: { agencyId: string; contactId: string }[];
  inquiries: Inquiry[];
  inquiryInputs: Record<string, unknown>[];
  plans: RecordRef[];
  quotes: string[];
  tours: RecordRef[];
  tourInputs: Record<string, unknown>[];
  ledgers: Ledger[];
  ledgerInputs: Record<string, unknown>[];
}
const businesses: Business[] = [];
let root: Actor, admin: Actor, executive: Actor;
let countryId: string, receivingGroupId: string;
let pickupFlightId: string, dropFlightId: string;
let groups = 0;

async function check(name: string, run: () => Promise<void>) {
  await run();
  console.log(`PASS ${++groups}: ${name}`);
}
const ids = (items: { id: string }[]) => items.map((item) => item.id).sort();
const inquiryPath = (b: Business) =>
  b.unit === 'shengxu' ? '/inquiries' : '/website/inquiries';
const logPath = (b: Business) =>
  b.unit === 'shengxu' ? '/inquiry-logs' : '/website/inquiry-logs';
const planPath = (b: Business) =>
  b.unit === 'shengxu' ? '/itineraries' : '/website/itineraries';
const frozenPath = (b: Business, index: number) =>
  `${planPath(b)}/${b.plans[index].id}/${b.unit === 'shengxu' ? 'pdf-data' : 'quotation'}`;
function linkedTourInput(b: Business) {
  return {
    sourceModule: b.unit === 'shengxu' ? 'standard' : 'website',
    inquiryId: b.inquiries[0].id,
    quoteId: b.quotes[0],
    operatorId: b.a.id,
    adults: 2,
    children: 0,
    leaders: 0,
    shopping: false,
    scheduleMode: 'flight',
    pickupFlightId,
    dropFlightId,
  };
}
async function deny(
  actor: Actor | undefined,
  method: string,
  path: string,
  body?: unknown,
  status = 403,
  code = 'AUTH_FORBIDDEN',
) {
  assert.equal(await h.call(actor, method, path, body, status, code), null);
}

async function fixtures() {
  [root, admin, executive] = await Promise.all(
    ['ROOT', 'ADMIN', 'EXECUTIVE'].map((role) => h.actor('headquarters', role)),
  );
  [{ id: countryId }] = await h.db.query<{ id: string }[]>(
    `INSERT INTO system_business_dictionary_items(type_id,code,name,english_name) SELECT id,'MYS','马来西亚','Malaysia' FROM system_business_dictionary_types WHERE code='country-region' RETURNING id`,
  );
  [{ id: receivingGroupId }] = await h.db.query<{ id: string }[]>(
    `SELECT id FROM business_groups ORDER BY name LIMIT 1`,
  );
  const airports = await h.db.query<
    { id: string }[]
  >(`INSERT INTO system_business_dictionary_items(type_id,code,name,english_name)
    SELECT t.id,v.code,v.code,v.code FROM system_business_dictionary_types t CROSS JOIN (VALUES('KMG'),('PVG')) v(code) WHERE t.code='city-airport' RETURNING id`);
  [pickupFlightId, dropFlightId] = [randomUUID(), randomUUID()];
  for (const [id, from, to, departure, arrival] of [
    [pickupFlightId, airports[0].id, airports[1].id, '07:00', '08:00'],
    [dropFlightId, airports[1].id, airports[0].id, '18:00', '19:00'],
  ])
    await h.db.query(
      `INSERT INTO resource_flights(id,departure_city,arrival_city,flight_number,departure_time,arrival_time,departure_airport_id,arrival_airport_id)
      VALUES($1,'A','B',$2,$3,$4,$5,$6)`,
      [
        id,
        id === pickupFlightId ? 'ISO1' : 'ISO2',
        departure,
        arrival,
        from,
        to,
      ],
    );
  for (const unit of ['shengxu', 'linxi', 'website'] as const) {
    const a = await h.actor(unit);
    const b = await h.actor(unit);
    const manager = await h.actor(unit, 'BUSINESS_MANAGER');
    const resource = await h.actor(unit, 'RESOURCE_MANAGER');
    const business: Business = {
      unit,
      a,
      b,
      manager,
      resource,
      agencies: [],
      inquiries: [],
      inquiryInputs: [],
      plans: [],
      quotes: [],
      tours: [],
      tourInputs: [],
      ledgers: [],
      ledgerInputs: [],
    };
    businesses.push(business);
    for (const actor of [a, b]) {
      const agencyId = randomUUID(),
        contactId = randomUUID();
      await h.db.query(
        `INSERT INTO resource_agencies(id,code,name,business_unit,coordinator_id,country_or_region,city,country_item_id) VALUES($1,next_business_code('AGY'),$2,$3,$4,'马来西亚','昆明',$5)`,
        [agencyId, `agency-${actor.id}`, unit, actor.id, countryId],
      );
      await h.db.query(
        `INSERT INTO resource_agency_contacts(id,agency_id,name,name_key) VALUES($1,$2,'Contact','contact')`,
        [contactId, agencyId],
      );
      business.agencies.push({ agencyId, contactId });
      const input =
        unit === 'shengxu'
          ? {
              agencyId,
              contactId,
              countryItemId: countryId,
              sourceChannel: 'isolation',
              originalMessage: '隔离测试',
              plannedDays: 1,
            }
          : {
              countryItemId: countryId,
              customerName: `customer-${actor.id}`,
              requirements: '隔离测试',
              plannedDays: 1,
            };
      business.inquiryInputs.push(input);
      const inquiry = await h.call<Inquiry>(
        actor,
        'POST',
        inquiryPath(business),
        input,
        201,
      );
      assert.equal(inquiry.businessUnit, unit);
      assert.equal(inquiry.ownerId, actor.id);
      business.inquiries.push(inquiry);
      // Minimal persisted plans/frozen snapshots exercise parent-scope joins;
      // quote calculation itself is outside this isolation suite.
      const planId = randomUUID(),
        quoteId = randomUUID();
      if (unit === 'shengxu') {
        await h.db.query(
          `INSERT INTO itineraries(id,inquiry_id,code,creator,title,start_date,pax_tiers,status) VALUES($1,$2,$3,'Fixture','Isolation','2030-01-01','{10}','quoted')`,
          [planId, inquiry.id, `IT-${planId}`],
        );
        await h.db.query(
          `INSERT INTO itinerary_quotes(id,itinerary_id,source_version,created_by,snapshot,quote_code,quote_version,inquiry_id,inquiry_version,daily_resource_cost,guide_cost,first_downloaded_at) VALUES($1,$2,1,$3,$4::jsonb,$5,1,$6,1,0,0,now())`,
          [
            quoteId,
            planId,
            actor.id,
            JSON.stringify({
              itinerary: {
                code: `IT-${planId}`,
                startDate: '2030-01-01',
                days: 1,
              },
              calculation: {},
            }),
            `QT-${quoteId}`,
            inquiry.id,
          ],
        );
      } else {
        await h.db.query(
          `INSERT INTO website_itineraries(id,inquiry_id,code,title,duration,start_date,config_version,status,business_unit) VALUES($1,$2,$3,'Isolation',1,'2030-01-01',(SELECT version FROM website_config_current WHERE business_unit=$4),'quoted',$4)`,
          [planId, inquiry.id, `WIT-${planId}`, unit],
        );
        await h.db.query(
          `INSERT INTO website_quotations(id,itinerary_id,code,snapshot,confirmed_by,first_downloaded_at) VALUES($1,$2,$3,$4::jsonb,$5,now())`,
          [
            quoteId,
            planId,
            `WQT-${quoteId}`,
            JSON.stringify({
              itinerary: {
                code: `WIT-${planId}`,
                startDate: '2030-01-01',
                days: 1,
              },
            }),
            actor.id,
          ],
        );
      }
      business.plans.push({ id: planId, version: 1, businessUnit: unit });
      business.quotes.push(quoteId);
      const tourInput = {
        sourceModule: 'manual',
        manualSource: {
          businessUnit: unit,
          countryItemId: countryId,
          collectCoordinatorId: actor.id,
          ...(unit === 'shengxu' ? { agencyId } : {}),
          itinerarySummary: '隔离测试',
          startDate: '2030-01-01',
          days: 1,
        },
        operatorId: actor.id,
        adults: 2,
        children: 0,
        leaders: 0,
        shopping: false,
        scheduleMode: 'manual',
        pickupAt: '2030-01-01 08:00',
        dropAt: '2030-01-01 18:00',
      };
      business.tourInputs.push(tourInput);
      business.tours.push(await h.call(root, 'POST', '/tours', tourInput, 201));
      if (unit !== 'shengxu') {
        const ledgerInput = {
          receivedDate: '2030-01-01',
          source: `source-${actor.id}`,
          operatorId: actor.id,
          ...(unit === 'linxi' ? { receivingGroupId } : {}),
        };
        business.ledgerInputs.push(ledgerInput);
        business.ledgers.push(
          await h.call<Ledger>(
            actor,
            'POST',
            '/ledgers/direct',
            ledgerInput,
            201,
          ),
        );
      }
    }
  }
}

async function ledgers() {
  const direct = businesses.filter((b) => b.unit !== 'shengxu');
  await check(
    '直客台账：两业务列表、计数、分页、筛选和历史人员选项',
    async () => {
      for (const b of direct) {
        const foreign = direct.find((other) => other !== b)!;
        for (const actor of [b.a, b.b, b.manager]) {
          await h.page(actor, '/ledgers/direct', ids(b.ledgers), 1);
          await h.page(actor, `/ledgers/direct?creatorId=${foreign.a.id}`, []);
          await h.page(actor, `/ledgers/direct?operatorId=${foreign.a.id}`, []);
          await h.page(
            actor,
            `/ledgers/direct?keyword=${foreign.ledgerInputs[0].source as string}`,
            [],
          );
          for (const kind of ['creator', 'operator'])
            await h.page(
              actor,
              `/ledgers/direct/filter-options?kind=${kind}`,
              [b.a.id, b.b.id],
              1,
            );
          const peer = await h.call<Ledger>(
            actor,
            'GET',
            `/ledgers/direct/${b.ledgers[1].id}`,
          );
          assert.equal(peer.capabilities.canEdit, actor !== b.a);
        }
        for (const who of [root, admin, executive])
          await h.page(
            who,
            `/ledgers/direct?businessUnit=${b.unit}`,
            ids(b.ledgers),
            1,
          );
        for (const selector of ['operators', 'collectors']) {
          await h.page(b.a, `/ledgers/direct/${selector}`, [b.a.id, b.b.id], 1);
        }
      }
    },
  );
  await check(
    '直客台账：跨业务 ID/入口/写入、同业务他人管理、引用和总部写入拒绝且数据不变',
    async () => {
      await h.unchanged(async () => {
        for (const b of direct) {
          const foreign = direct.find((other) => other !== b)!;
          const row = foreign.ledgers[0];
          for (const actor of [b.a, b.manager]) {
            for (const path of [
              '',
              '/operators',
              '/collectors',
              '/receiving-groups',
              '/filter-options?kind=creator',
            ])
              await deny(
                actor,
                'GET',
                `/ledgers/direct${path}${path.includes('?') ? '&' : '?'}businessUnit=${foreign.unit}`,
              );
            await deny(
              actor,
              'GET',
              `/ledgers/direct/${row.id}`,
              undefined,
              404,
              'NOT_FOUND',
            );
            await deny(
              actor,
              'PUT',
              `/ledgers/direct/${row.id}`,
              { ...foreign.ledgerInputs[0], version: row.version },
              404,
              'NOT_FOUND',
            );
            await deny(
              actor,
              'DELETE',
              `/ledgers/direct/${row.id}?version=${row.version}`,
              undefined,
              404,
              'NOT_FOUND',
            );
            await deny(
              actor,
              'PUT',
              `/ledgers/direct/${row.id}/operation`,
              { version: row.version },
              404,
              'NOT_FOUND',
            );
            if (actor === b.manager)
              await deny(
                actor,
                'POST',
                `/ledgers/direct/${row.id}/review`,
                { version: row.version },
                404,
                'NOT_FOUND',
              );
            await deny(actor, 'POST', '/ledgers/direct', {
              ...b.ledgerInputs[0],
              businessUnit: foreign.unit,
            });
          }
          await deny(
            b.a,
            'POST',
            '/ledgers/direct',
            { ...b.ledgerInputs[0], operatorId: foreign.a.id },
            400,
            'VALIDATION_ERROR',
          );
          const peer = b.ledgers[1];
          await deny(b.a, 'PUT', `/ledgers/direct/${peer.id}`, {
            ...b.ledgerInputs[1],
            version: peer.version,
          });
          await deny(
            b.a,
            'DELETE',
            `/ledgers/direct/${peer.id}?version=${peer.version}`,
          );
          await deny(b.a, 'PUT', `/ledgers/direct/${peer.id}/operation`, {
            version: peer.version,
          });
          for (const who of [root, admin, executive]) {
            await deny(who, 'PUT', `/ledgers/direct/${peer.id}`, {
              ...b.ledgerInputs[1],
              version: peer.version,
            });
            await deny(
              who,
              'DELETE',
              `/ledgers/direct/${peer.id}?version=${peer.version}`,
            );
            await deny(who, 'POST', `/ledgers/direct/${peer.id}/review`, {
              version: peer.version,
            });
            await deny(who, 'PUT', `/ledgers/direct/${peer.id}/operation`, {
              version: peer.version,
            });
            if (who !== root)
              await deny(who, 'POST', '/ledgers/direct', {
                ...b.ledgerInputs[0],
                businessUnit: b.unit,
                creatorId: b.a.id,
              });
          }
          await deny(b.resource, 'GET', '/ledgers/direct');
        }
        await deny(businesses[0].a, 'GET', '/ledgers/direct');
      });
    },
  );
  await check(
    '直客台账：本业务编辑、负责人确认、指定计调操作和 ROOT 代建正向路径',
    async () => {
      for (const b of direct) {
        const row = b.ledgers[0];
        const edited = await h.call(b.a, 'PUT', `/ledgers/direct/${row.id}`, {
          ...b.ledgerInputs[0],
          loss: true,
          version: row.version,
        });
        assert.equal(edited.version, row.version + 1);
        const reviewed = await h.call(
          b.manager,
          'POST',
          `/ledgers/direct/${row.id}/review`,
          { version: edited.version },
        );
        const operated = await h.call<RecordRef & { operated: boolean }>(
          b.a,
          'PUT',
          `/ledgers/direct/${row.id}/operation`,
          { version: reviewed.version },
        );
        assert.equal(operated.operated, true);
        const created = await h.call(
          root,
          'POST',
          '/ledgers/direct',
          { ...b.ledgerInputs[0], businessUnit: b.unit, creatorId: b.a.id },
          201,
        );
        assert.equal(created.businessUnit, b.unit);
      }
    },
  );
}

async function inquiries() {
  await check(
    '三业务询盘：本人/负责人/总部列表、分页、计数、关联行程与日志统计',
    async () => {
      for (const b of businesses) {
        const path = inquiryPath(b),
          logs = logPath(b);
        await h.page(b.a, path, [b.inquiries[0].id]);
        await h.page(b.a, `${path}?ownerId=${b.b.id}`, []);
        await h.page(b.manager, path, ids(b.inquiries), 1);
        for (const who of [root, admin, executive])
          await h.page(
            who,
            `${path}?businessUnit=${b.unit}`,
            ids(b.inquiries),
            1,
          );
        const detail = await h.call<Inquiry>(
          b.a,
          'GET',
          `${path}/${b.inquiries[0].id}`,
        );
        assert.equal(detail.ownerId, b.a.id);
        assert.equal(detail.businessUnit, b.unit);
        const plans = await h.call<RecordRef[]>(
          b.a,
          'GET',
          `${path}/${detail.id}/itineraries`,
        );
        assert.deepEqual(ids(plans), [b.plans[0].id]);
        await h.call(b.a, 'GET', `${planPath(b)}/${b.plans[0].id}`);
        const frozen = await h.call<{ itinerary: { code: string } }>(
          b.a,
          'GET',
          frozenPath(b, 0),
        );
        assert.equal(
          frozen.itinerary.code,
          `${b.unit === 'shengxu' ? 'IT' : 'WIT'}-${b.plans[0].id}`,
        );
        for (const who of [b.a, b.manager]) {
          const expected = who === b.a ? [b.inquiries[0].id] : ids(b.inquiries);
          const entries = await h.call<Page<{ inquiryId: string }>>(
            who,
            'GET',
            `${logs}?pageSize=100`,
          );
          assert.equal(entries.total, expected.length);
          assert.deepEqual(
            entries.list.map((log) => log.inquiryId).sort(),
            expected,
          );
          const report = await h.call<{
            totalOperations: number;
            inquiryCount: number;
          }>(who, 'GET', `${logs}/report?pageSize=1`);
          assert.equal(report.totalOperations, expected.length);
          assert.equal(report.inquiryCount, expected.length);
          const operators = await h.call<Option[]>(
            who,
            'GET',
            `${logs}/operators`,
          );
          assert.deepEqual(
            ids(operators),
            who === b.a ? [b.a.id] : [b.a.id, b.b.id].sort(),
          );
        }
      }
      await h.page(
        root,
        '/website/inquiries',
        ids(businesses.slice(1).flatMap((b) => b.inquiries)),
        1,
      );
    },
  );
  await check(
    '三业务询盘：越界详情/更新/归档/行程及冻结报价读取、跨业务筛选和资源角色拒绝',
    async () => {
      await h.unchanged(async () => {
        for (const b of businesses) {
          const path = inquiryPath(b);
          // Same-business ownership is narrower than the business-manager scope.
          const peer = b.inquiries[1];
          const missing = 'INQUIRY_NOT_FOUND';
          await deny(b.a, 'GET', `${path}/${peer.id}`, undefined, 404, missing);
          await deny(
            b.a,
            'PUT',
            `${path}/${peer.id}`,
            { ...b.inquiryInputs[1], version: peer.version },
            404,
            missing,
          );
          await deny(
            b.a,
            'GET',
            `${path}/${peer.id}/itineraries`,
            undefined,
            404,
            missing,
          );
          await deny(
            b.a,
            'GET',
            `${planPath(b)}/${b.plans[1].id}`,
            undefined,
            404,
            'INQUIRY_NOT_FOUND',
          );
          await deny(b.a, 'GET', frozenPath(b, 1), undefined, 404, missing);
          const foreignBusiness = businesses.find(
            (other) => other !== b && other.unit !== 'shengxu',
          )!;
          for (const actor of [foreignBusiness.a, foreignBusiness.manager]) {
            await deny(
              actor,
              'GET',
              `${path}/${b.inquiries[0].id}`,
              undefined,
              404,
              missing,
            );
            await deny(
              actor,
              'PUT',
              `${path}/${b.inquiries[0].id}`,
              { ...b.inquiryInputs[0], version: b.inquiries[0].version },
              404,
              missing,
            );
            await deny(
              actor,
              'GET',
              `${path}/${b.inquiries[0].id}/itineraries`,
              undefined,
              404,
              missing,
            );
            await deny(
              actor,
              'GET',
              `${planPath(b)}/${b.plans[0].id}`,
              undefined,
              404,
              'INQUIRY_NOT_FOUND',
            );
            await deny(actor, 'GET', frozenPath(b, 0), undefined, 404, missing);
            await deny(
              actor,
              'POST',
              `${path}/${b.inquiries[0].id}/archive`,
              { version: b.inquiries[0].version },
              actor === foreignBusiness.manager ? 404 : 403,
              actor === foreignBusiness.manager ? missing : 'AUTH_FORBIDDEN',
            );
          }
          await deny(b.resource, 'GET', path);
          for (const who of [admin, executive])
            await deny(who, 'PUT', `${path}/${b.inquiries[0].id}`, {
              ...b.inquiryInputs[0],
              version: b.inquiries[0].version,
            });
          if (b.unit !== 'shengxu') {
            const foreignUnit = b.unit === 'linxi' ? 'website' : 'linxi';
            for (const endpoint of [
              path,
              logPath(b),
              `${logPath(b)}/report`,
              `${logPath(b)}/operators`,
              '/website/owners',
              '/website/config',
            ])
              await deny(b.a, 'GET', `${endpoint}?businessUnit=${foreignUnit}`);
            await deny(b.a, 'POST', path, {
              ...b.inquiryInputs[0],
              businessUnit: foreignUnit,
            });
            await deny(
              b.manager,
              'POST',
              path,
              { ...b.inquiryInputs[0], ownerId: foreignBusiness.a.id },
              400,
              'INQUIRY_OWNER_INVALID',
            );
            for (const endpoint of [
              logPath(b),
              `${logPath(b)}/report`,
              `${logPath(b)}/operators`,
            ])
              await deny(
                b.a,
                'GET',
                `${endpoint}?inquiryId=${peer.id}`,
                undefined,
                404,
                missing,
              );
          } else {
            await deny(b.a, 'GET', '/inquiries?businessUnit=linxi');
            await deny(b.a, 'GET', '/inquiry-logs?businessUnit=website');
            await deny(b.a, 'GET', '/website/inquiries');
          }
        }
      });
    },
  );
  await check(
    '询盘：同业务转交成功、旧负责人失去读取权、日志跟随当前归属，跨业务转交不改数据',
    async () => {
      for (const b of businesses) {
        const path = inquiryPath(b),
          row = b.inquiries[0];
        const foreign = businesses.find(
          (other) => other.unit !== 'shengxu' && other !== b,
        )!;
        await h.unchanged(async () => {
          await deny(
            b.manager,
            'POST',
            `${path}/${row.id}/transfer`,
            {
              version: row.version,
              ownerId: foreign.a.id,
              reason: 'cross-business',
            },
            400,
            'INQUIRY_OWNER_INVALID',
          );
        });
        const edited = await h.call<Inquiry>(b.a, 'PUT', `${path}/${row.id}`, {
          ...b.inquiryInputs[0],
          internalRemark: 'valid edit',
          version: row.version,
        });
        assert.equal(edited.version, row.version + 1);
        const moved = await h.call<Inquiry>(
          b.manager,
          'POST',
          `${path}/${row.id}/transfer`,
          {
            version: edited.version,
            ownerId: b.b.id,
            reason: 'same-business transfer',
          },
          201,
        );
        assert.equal(moved.ownerId, b.b.id);
        await deny(
          b.a,
          'GET',
          `${path}/${row.id}`,
          undefined,
          404,
          'INQUIRY_NOT_FOUND',
        );
        await h.page(b.a, path, []);
        await h.page(b.b, path, ids(b.inquiries));
        const oldLogs = await h.call<Page>(b.a, 'GET', logPath(b));
        assert.equal(oldLogs.total, 0);
        const newLogs = await h.call<Page<{ inquiryId: string }>>(
          b.b,
          'GET',
          `${logPath(b)}?inquiryId=${row.id}`,
        );
        assert(newLogs.total >= 3);
        assert(newLogs.list.every((log) => log.inquiryId === row.id));
      }
    },
  );
}

async function tours() {
  await check(
    '成团表：三业务本人关联/负责人/总部、列表计数分页与历史筛选',
    async () => {
      for (const b of businesses) {
        await h.page(b.a, '/tours', [b.tours[0].id]);
        await h.page(b.manager, '/tours', ids(b.tours), 1);
        await h.page(b.a, `/tours?collectCoordinatorId=${b.b.id}`, []);
        for (const who of [root, admin, executive])
          await h.page(who, `/tours?businessUnit=${b.unit}`, ids(b.tours), 1);
        for (const kind of ['collectCoordinator', 'operator']) {
          await h.page(b.a, `/tours/filter-options?kind=${kind}`, [b.a.id]);
          await h.page(
            b.manager,
            `/tours/filter-options?kind=${kind}`,
            [b.a.id, b.b.id],
            1,
          );
        }
        const operators = await h.call<Option[]>(
          b.a,
          'GET',
          `/tours/operators?businessUnit=${b.unit}`,
        );
        assert.deepEqual(ids(operators), [b.a.id, b.b.id].sort());
        const source = b.unit === 'shengxu' ? 'standard' : 'website';
        const sources = await h.call<{ inquiryId: string }[]>(
          b.manager,
          'GET',
          `/tours/sources?sourceModule=${source}`,
        );
        assert.deepEqual(
          sources.map((s) => s.inquiryId).sort(),
          ids(b.inquiries),
        );
      }
      await h.page(root, '/tours', ids(businesses.flatMap((b) => b.tours)), 1);
    },
  );
  await check(
    '成团表：跨业务/同业务他人详情、修改、撤销、操作人和关联来源阻断',
    async () => {
      await h.unchanged(async () => {
        for (const b of businesses) {
          const foreign = businesses.find((other) => other !== b)!;
          const { sourceModule: _source, ...update } = b.tourInputs[0];
          void _source;
          for (const actor of [foreign.a, foreign.manager, b.b]) {
            const row = b.tours[0];
            await deny(
              actor,
              'GET',
              `/tours/${row.id}`,
              undefined,
              404,
              'NOT_FOUND',
            );
            await deny(
              actor,
              'PUT',
              `/tours/${row.id}`,
              { ...update, version: row.version },
              actor === b.b ? 403 : 404,
              actor === b.b ? 'AUTH_FORBIDDEN' : 'NOT_FOUND',
            );
            await deny(
              actor,
              'POST',
              `/tours/${row.id}/cancel`,
              {
                version: row.version,
                reason: 'denied',
              },
              actor === b.b ? 403 : 404,
              actor === b.b ? 'AUTH_FORBIDDEN' : 'NOT_FOUND',
            );
          }
          await deny(
            foreign.a,
            'GET',
            `/tours/operators?businessUnit=${b.unit}`,
          );
          await h.page(foreign.a, `/tours?businessUnit=${b.unit}`, []);
          await h.page(
            foreign.a,
            `/tours/filter-options?kind=operator&businessUnit=${b.unit}`,
            [],
          );
          for (const who of [admin, executive]) {
            await deny(who, 'PUT', `/tours/${b.tours[0].id}`, {
              ...update,
              version: b.tours[0].version,
            });
            await deny(who, 'POST', `/tours/${b.tours[0].id}/cancel`, {
              version: b.tours[0].version,
            });
          }
          await deny(b.resource, 'GET', '/tours');
          const linked = linkedTourInput(b);
          const sourceActor = businesses.find(
            (other) => other !== b && other.unit !== 'shengxu',
          )!.manager;
          await deny(
            sourceActor,
            'POST',
            '/tours',
            linked,
            404,
            'INQUIRY_NOT_FOUND',
          );
        }
      });
    },
  );
  await check('成团来源：相同有效关联载荷由 ROOT 创建和撤销成功', async () => {
    for (const b of businesses) {
      const created = await h.call(
        root,
        'POST',
        '/tours',
        linkedTourInput(b),
        201,
      );
      assert.equal(created.businessUnit, b.unit);
      await h.call(
        root,
        'POST',
        `/tours/${created.id}/cancel`,
        { version: created.version, reason: 'positive source control' },
        201,
      );
    }
  });
  await check(
    '成团表：本业务编辑/撤销有效；实时计调分工仅收客403，改回操作恢复访问',
    async () => {
      for (const b of businesses) {
        const { sourceModule: _source, ...input } = b.tourInputs[0];
        void _source;
        const edited = await h.call(b.a, 'PUT', `/tours/${b.tours[0].id}`, {
          ...input,
          remark: 'valid edit',
          version: b.tours[0].version,
        });
        assert.equal(edited.version, b.tours[0].version + 1);
        await h.call(
          b.a,
          'POST',
          `/tours/${edited.id}/cancel`,
          { version: edited.version, reason: 'valid cancel' },
          201,
        );
        if (b.unit !== 'shengxu') {
          await h.db.query(
            `UPDATE user_identities SET coordinator_duty='reception' WHERE id=$1`,
            [b.a.identityId],
          );
          await deny(b.a, 'GET', '/tours');
          await h.db.query(
            `UPDATE user_identities SET coordinator_duty='operation' WHERE id=$1`,
            [b.a.identityId],
          );
          await h.call(b.a, 'GET', `/tours/${edited.id}`);
        }
      }
    },
  );
}

async function main() {
  try {
    await h.start();
    await fixtures();
    await check('未认证请求401；有效 JWT 绑定真实会话和当前身份', async () => {
      for (const path of [
        '/ledgers/direct',
        '/tours',
        '/inquiries',
        '/website/inquiries',
      ])
        await deny(
          undefined,
          'GET',
          path,
          undefined,
          401,
          'AUTH_TOKEN_INVALID',
        );
    });
    await ledgers();
    // Tours still use original ownership/source fixtures before inquiry transfer.
    await tours();
    await inquiries();
    await boundaries();
    console.log(
      `Business isolation passed: ${groups} groups, ${h.requests} HTTP checks; real JWT/guards/services/PostgreSQL. No business database accessed.`,
    );
  } finally {
    await h.close();
  }
}

async function boundaries() {
  await check('盛旭台账入口与组团社引用隔离，公共资源保持共享', async () => {
    const sx = businesses[0];
    const input = {
      recordDate: '2030-01-01',
      ...sx.agencies[0],
      quotedGroups: 1,
      convertedGroups: 0,
    };
    const row = await h.call(sx.a, 'POST', '/ledgers/shengxu', input, 201);
    await h.page(sx.b, '/ledgers/shengxu', [row.id]);
    await h.unchanged(async () => {
      await deny(sx.b, 'PUT', `/ledgers/shengxu/${row.id}`, {
        ...input,
        version: row.version,
      });
      for (const b of businesses.slice(1)) {
        await deny(b.a, 'GET', '/ledgers/shengxu');
        await deny(b.manager, 'GET', `/ledgers/shengxu/${row.id}`);
        await deny(
          sx.a,
          'POST',
          '/ledgers/shengxu',
          { ...input, ...b.agencies[0] },
          400,
          'VALIDATION_ERROR',
        );
      }
    });
    const allAgencies = businesses.flatMap((b) =>
      b.agencies.map((agency) => agency.agencyId),
    );
    for (const b of businesses)
      await h.page(b.a, '/resources/selections/agencies', allAgencies, 2);
  });
  await check(
    '直客专属配置：当前业务版本可读，另一业务历史版本及写入口不可读写',
    async () => {
      const direct = businesses.slice(1);
      for (const b of direct) {
        const foreign = direct.find((other) => other !== b)!;
        const ownConfig = await h.call<{ version: number }>(
          b.resource,
          'GET',
          '/website/config',
        );
        const foreignConfig = await h.call<{ version: number }>(
          foreign.resource,
          'GET',
          '/website/config',
        );
        assert.notEqual(ownConfig.version, foreignConfig.version);
        await h.unchanged(async () => {
          await deny(
            b.resource,
            'GET',
            `/website/config?version=${foreignConfig.version}`,
            undefined,
            404,
            'NOT_FOUND',
          );
          await deny(
            b.resource,
            'PUT',
            `/website/config?businessUnit=${foreign.unit}`,
            ownConfig,
          );
        });
      }
    },
  );
  await check(
    '同账号多身份：本业务 JWT 不叠加另一业务或总部 ROOT 的数据权限',
    async () => {
      // Legacy mixed accounts can still be read: identical user IDs must never
      // replace the current identity's business predicate.
      const lx = await h.actor('linxi');
      const web = await h.actor('website', 'COORDINATOR', 'both', lx.id);
      await h.actor('headquarters', 'ROOT', null, lx.id);
      const pairs: {
        actor: Actor;
        inquiry: Inquiry;
        ledger: RecordRef;
        tour: RecordRef;
      }[] = [];
      for (const actor of [lx, web]) {
        const inquiry = await h.call<Inquiry>(
          actor,
          'POST',
          '/website/inquiries',
          {
            countryItemId: countryId,
            customerName: 'multi-identity',
            requirements: 'current identity only',
            plannedDays: 1,
          },
          201,
        );
        const ledger = await h.call(
          actor,
          'POST',
          '/ledgers/direct',
          {
            receivedDate: '2030-01-01',
            source: 'multi-identity',
            operatorId: actor.id,
            ...(actor.scope === 'linxi' ? { receivingGroupId } : {}),
          },
          201,
        );
        const tour = await h.call(
          root,
          'POST',
          '/tours',
          {
            ...businesses[1].tourInputs[0],
            operatorId: actor.id,
            manualSource: {
              businessUnit: actor.scope,
              countryItemId: countryId,
              collectCoordinatorId: actor.id,
              itinerarySummary: 'multi-identity',
              startDate: '2030-01-01',
              days: 1,
            },
          },
          201,
        );
        pairs.push({ actor, inquiry, ledger, tour });
      }
      await h.unchanged(async () => {
        for (const own of pairs) {
          const other = pairs.find((pair) => pair !== own)!;
          await h.page(own.actor, '/website/inquiries', [own.inquiry.id]);
          await h.page(own.actor, `/ledgers/direct?creatorId=${own.actor.id}`, [
            own.ledger.id,
          ]);
          await h.page(own.actor, '/tours', [own.tour.id]);
          await deny(
            own.actor,
            'GET',
            `/website/inquiries/${other.inquiry.id}`,
            undefined,
            404,
            'INQUIRY_NOT_FOUND',
          );
          await deny(
            own.actor,
            'GET',
            `/ledgers/direct/${other.ledger.id}`,
            undefined,
            404,
            'NOT_FOUND',
          );
          await deny(
            own.actor,
            'GET',
            `/tours/${other.tour.id}`,
            undefined,
            404,
            'NOT_FOUND',
          );
          await deny(own.actor, 'POST', '/ledgers/direct', {
            receivedDate: '2030-01-01',
            source: 'forged HQ delegation',
            operatorId: own.actor.id,
            businessUnit: other.actor.scope,
            creatorId: own.actor.id,
          });
        }
      });
    },
  );
}
void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
