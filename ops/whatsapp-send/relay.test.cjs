const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createRelay, validateSend, validateLookup, lookupMessageId } = require('./relay.cjs');

test('relay restricts request shape to text/reaction sends without credential or action overrides', () => {
  const text = { recipient: 'ZZ.synthetic', text: 'hello', taskId: randomUUID() };
  assert.equal(validateSend(text), true);
  assert.equal(validateSend({ ...text, recipient: 'https://example.invalid/' }), false);
  assert.equal(validateSend({ ...text, action: 'CreateAccessKey' }), false);
  assert.equal(validateSend({ ...text, phone: '0000000001' }), false);
  assert.equal(validateSend({ ...text, text: '' }), false);
  assert.equal(validateSend({ ...text, text: 'x'.repeat(4097) }), false);
  assert.equal(validateSend({ ...text, contextMessageId: 'original-id' }), true);
  for (const contextMessageId of ['', 123, 'x'.repeat(1001)]) assert.equal(validateSend({ ...text, contextMessageId }), false);
  assert.equal(validateSend({ ...text, text: '👍', contextMessageId: 'id', reaction: { messageId: 'id', emoji: '👍' } }), false);
  for (const emoji of ['👍', '']) assert.equal(validateSend({ ...text, text: emoji, reaction: { messageId: 'wamid.synthetic-message', emoji } }), true);
  assert.equal(validateSend({ ...text, text: '👍', reaction: { messageId: 'id', emoji: '👍', endpoint: 'bad' } }), false);
  assert.equal(validateSend({ ...text, text: '👍', reaction: { messageId: '', emoji: '👍' } }), false);
});

test('relay forwards the quoted provider ID intact without exposing general SDK options', async () => {
  let received;
  const relay = createRelay(async (body) => { received = body; return { status: 'accepted', providerId: 'reply-id' }; }, async () => {});
  await new Promise((resolve) => relay.listen(0, '127.0.0.1', resolve));
  try {
    const body = { recipient: 'ZZ.synthetic', text: '*hello*', taskId: randomUUID(), contextMessageId: 'original-id' };
    const response = await fetch(`http://127.0.0.1:${relay.address().port}/send`, { method: 'POST', body: JSON.stringify(body) });
    assert.equal(response.status, 200);
    assert.deepEqual(received, body);
  } finally { await new Promise((resolve) => relay.close(resolve)); }
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


test('message lookup restricts time window and fixed-account request shape', () => {
  const body = { providerId: 'provider-id', occurredAt: Date.now() };
  assert.equal(validateLookup(body), true);
  for (const override of [{spaceId:'override'}, {phone:'override'}, {action:'SendChatappMessage'}, {occurredAt:Date.now()+120000}, {occurredAt:Date.now()-32*86400000}]) assert.equal(validateLookup({...body,...override}),false);
  assert.equal(validateSend({recipient:'ZZ.synthetic',text:'👍',taskId:randomUUID(),reaction:{messageId:'123456',emoji:'👍'}}),false);
});
test('message lookup only returns exact provider and business IDs, never guesses', async () => {
  const config = { spaceId:'space', phone:'0000000000' };
  let calls=0;
  const client = {listChatappMessageWithOptions:async req=>{
    calls++;assert.equal(req.businessNumber,config.phone);assert.equal(req.custSpaceId,config.spaceId);
    return {body:{code:'OK',data:[{messageId:'target',businessNumber:'wrong',uniqueMessageId:'wamid.wrong'},{messageId:'target',businessNumber:config.phone,uniqueMessageId:'wamid.correct'}]}};
  }};
  assert.deepEqual(await lookupMessageId(client,config,{providerId:'target',occurredAt:Date.now()}),{found:true,messageId:'wamid.correct'});
  assert.equal(calls,1);
  assert.deepEqual(await lookupMessageId(client,config,{providerId:'missing',occurredAt:Date.now()}),{found:false});
});
test('lookup endpoint cannot send and returns only the target mapping', async () => {
  let sends=0;
  const relay=createRelay(async()=>{sends++;},async()=>{},async()=>({found:true,messageId:'wamid.exact'}));
  await new Promise(resolve=>relay.listen(0,'127.0.0.1',resolve));
  try{
    const response=await fetch(`http://127.0.0.1:${relay.address().port}/message-id`,{method:'POST',body:JSON.stringify({providerId:'provider',occurredAt:Date.now()})});
    assert.deepEqual(await response.json(),{found:true,messageId:'wamid.exact'});assert.equal(sends,0);
  }finally{await new Promise(resolve=>relay.close(resolve));}
});
