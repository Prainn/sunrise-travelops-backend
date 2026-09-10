import test from 'node:test';
import assert from 'node:assert/strict';
import { isStale, displayStatus, actionLink } from './status.mjs';

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
