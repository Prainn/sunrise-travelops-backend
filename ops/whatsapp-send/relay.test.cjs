const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createRelay, validateSend } = require('./relay.cjs');

test('relay restricts request shape to text/reaction sends without credential or action overrides', () => {
  const text = { recipient: 'ZZ.synthetic', text: 'hello', taskId: randomUUID() };
  assert.equal(validateSend(text), true);
  assert.equal(validateSend({ ...text, recipient: 'https://example.invalid/' }), false);
  assert.equal(validateSend({ ...text, action: 'CreateAccessKey' }), false);
  assert.equal(validateSend({ ...text, phone: '0000000001' }), false);
  assert.equal(validateSend({ ...text, text: '' }), false);
  assert.equal(validateSend({ ...text, text: 'x'.repeat(4097) }), false);
  for (const emoji of ['👍', '']) assert.equal(validateSend({ ...text, text: emoji, reaction: { messageId: 'synthetic-message', emoji } }), true);
  assert.equal(validateSend({ ...text, text: '👍', reaction: { messageId: 'id', emoji: '👍', endpoint: 'bad' } }), false);
  assert.equal(validateSend({ ...text, text: '👍', reaction: { messageId: '', emoji: '👍' } }), false);
});

test('relay exposes results and credential readiness, never retries a send after failure', async () => {
  let sends = 0;
  const relay = createRelay(async () => { sends++; throw new Error('secret'); }, async () => {});
  await new Promise((resolve) => relay.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${relay.address().port}`;
  try {
    assert.deepEqual(await (await fetch(`${base}/health`)).json(), { ready: true });
    assert.equal(sends, 0);
    const result = await fetch(`${base}/send`, { method: 'POST', body: JSON.stringify({ recipient: 'ZZ.synthetic', text: 'hello', taskId: randomUUID() }) });
    assert.deepEqual(await result.json(), { status: 'unknown', errorCode: 'PROVIDER_RESULT_UNKNOWN' });
    assert.equal(sends, 1);
    assert.equal((await fetch(`${base}/send`, { method: 'POST', body: '{}' })).status, 400);
    assert.equal(sends, 1);
    assert.equal((await fetch(`${base}/credentials`)).status, 404);
  } finally { await new Promise((resolve) => relay.close(resolve)); }
});
