import test from 'node:test';
import assert from 'node:assert/strict';
import { isStale, displayStatus, actionLink, requestSnapshot } from './status.mjs';

test('expired or invalid snapshots cannot keep a green status', () => {
  const now = Date.parse('2026-09-10T04:00:00Z');
  assert.equal(isStale({ checkedAt: '2026-09-10T03:56:59Z' }, now), true);
  assert.equal(isStale({ checkedAt: '2026-09-10T03:59:00Z' }, now), false);
  assert.equal(isStale({ checkedAt: '2026-09-10T05:00:00Z' }, now), true);
  assert.equal(isStale({}, now), true);
  assert.equal(displayStatus('up', true, 'service'), 'unknown');
  assert.equal(displayStatus('success', true, 'deployment'), 'unknown');
});
test('service health and deployment failures remain independent', () => {
  assert.equal(displayStatus('up', false, 'service'), 'up');
  assert.equal(displayStatus('failure', false, 'deployment'), 'failure');
  assert.equal(displayStatus('anything', false, 'service'), 'unknown');
});
test('only known Actions URLs become public links', () => {
  assert.equal(actionLink('javascript:alert(1)'), null);
  assert.equal(actionLink('https://github.com.evil.test/Prainn/sunrise-travelops-web/actions/runs/1'), null);
  assert.equal(actionLink('https://github.com/Prainn/sunrise-travelops-web/actions/runs/123'), 'https://github.com/Prainn/sunrise-travelops-web/actions/runs/123');
});

const snapshot = { environment: 'development', services: {}, deployments: {} };
test('manual refresh POSTs a real collection, polling only reads the snapshot', async () => {
  const calls = [];
  const fetcher = async (...args) => { calls.push(args); return Response.json(snapshot); };
  assert.deepEqual((await requestSnapshot(true, fetcher)).snapshot, snapshot);
  assert.equal(calls[0][0], '/refresh');
  assert.equal(calls[0][1].method, 'POST');
  assert.equal(calls[0][1].headers['X-Status-Refresh'], '1');
  await requestSnapshot(false, fetcher);
  assert.equal(calls[1][0], '/status.json');
  assert.equal(calls[1][1].method, 'GET');
  assert.equal(calls[1][1].cache, 'no-store');
});

test('cooldown, concurrent collection and quota show explicit notices with a readable snapshot', async () => {
  for (const [status, error, message] of [[429, 'refresh_cooldown', '冷却'], [409, 'collection_in_progress', '正在进行'], [429, 'github_budget_exhausted', '额度']]) {
    const calls = [];
    const fetcher = async (path) => {
      calls.push(path);
      return path === '/refresh' ? Response.json({ error }, { status, headers: { 'Retry-After': '42' } }) : Response.json(snapshot);
    };
    const result = await requestSnapshot(true, fetcher);
    assert.deepEqual(calls, ['/refresh', '/status.json']);
    assert.deepEqual(result.snapshot, snapshot);
    assert.ok(result.notice.includes(message));
    assert.ok(result.notice.includes('42 秒'));
    assert.ok(!result.notice.includes('检测已完成'));
  }
});

test('failed refresh and malformed snapshots do not report completion', async () => {
  await assert.rejects(requestSnapshot(true, async () => new Response('', { status: 503 })));
  await assert.rejects(requestSnapshot(true, async () => { throw new Error('timeout'); }));
  await assert.rejects(requestSnapshot(false, async () => Response.json({})));
});

test('Actions query age is independent of freshly regenerated snapshot time', () => {
  const now = Date.parse('2026-09-10T04:00:00Z');
  assert.equal(isStale({ checkedAt: '2026-09-10T03:59:00Z' }, now), false);
  assert.equal(isStale({ checkedAt: '2026-09-10T03:49:59Z' }, now, 600000), true);
  assert.equal(isStale({ checkedAt: '2026-09-10T03:55:00Z' }, now, 600000), false);
});
