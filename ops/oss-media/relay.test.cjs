'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRelay, validate } = require('./relay.cjs');
const key = 'dev/whatsapp/00000000-0000-4000-8000-000000000001/original.png';
test('relay bounds environment, keys, body size and MIME', () => {
  const value = { action: 'put', key, body: Buffer.from('synthetic').toString('base64'), mime: 'image/png' };
  assert(validate(value, 'dev'));
  assert(!validate(value, 'prod'));
  for (const k of [key.replace('dev/', 'prod/'), '../' + key, key + '?x', key.replace('original.png', 'x.html')]) assert(!validate({ ...value, key: k }, 'dev'));
  assert(!validate({ ...value, mime: 'text/html' }, 'dev'));
  assert(!validate({ ...value, body: Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64') }, 'dev'));
  assert(!validate({ ...value, credentials: true }, 'dev'));
  assert(validate({ action: 'delete', keys: [key] }, 'dev'));
  assert(!validate({ action: 'delete', keys: [key.replace('dev/', 'prod/')] }, 'dev'));
});

test('management upload keys allow put and delete only in the current environment', () => {
  const uploadKey = key.replace('/whatsapp/', '/upload/');
  const value = { action: 'put', key: uploadKey, body: 'eA==', mime: 'image/png' };
  const remove = { action: 'delete', keys: [uploadKey, uploadKey.replace('original.png', 'thumbnail.webp')] };
  assert(validate(value, 'dev'));
  assert(validate(remove, 'dev'));
  assert(!validate(value, 'prod'));
  assert(!validate(remove, 'prod'));
  assert(!validate({ ...value, key: uploadKey.replace('/upload/', '/other/') }, 'dev'));
});

test('documents only use the private environment prefix and bound binary uploads', async () => {
  const documentKey = 'private/dev/whatsapp/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002.pdf';
  const value = { action: 'sign-document', key: documentKey, purpose: 'send', fileName: '行程.PDF' };
  assert(validate(value, 'dev'));
  assert(!validate(value, 'prod'));
  assert(!validate({ ...value, key: key }, 'dev'));
  assert(!validate({ ...value, fileName: 'file.pdf\r\nbad' }, 'dev'));
  let request;
  const server = createRelay({environment:'dev'}, async (input) => { request=input; return {etag:'example'}; });
  await new Promise(resolve=> server.listen(0,'127.0.0.1',resolve));
  try {
    const url='http://127.0.0.1:' + server.address().port + '/documents';
    const init={ method:'PUT', headers:{'content-type':'application/octet-stream','x-oss-object-key':documentKey}, body:Buffer.from('synthetic') };
    assert.equal((await fetch(url,init)).status, 200);
    assert.equal(request.action,'put-document');
    assert.equal(request.mime,'application/pdf');
    assert.equal(request.body.toString(),'synthetic');
    assert.equal((await fetch(url,{...init,headers:{...init.headers,'x-oss-object-key':documentKey.replace('/dev/','/prod/')}})).status,400);
  } finally { await new Promise(resolve=>server.close(resolve)); }
});

test('mail attachments stream unchanged to the private email prefix and sign arbitrary original filenames', async () => {
  const mailKey = 'private/dev/email/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002.bin';
  const sign = {action:'sign-document', key:mailKey, purpose:'download', fileName:'客户.png'};
  assert(validate(sign,'dev'));
  assert(!validate(sign,'prod'));
  assert(!validate({...sign,fileName:'../客户.png'},'dev'));
  assert(!validate({...sign,key:mailKey.replace('/email/','/whatsapp/')},'dev'));
  let received;
  const server=createRelay({environment:'dev'}, async input=>{
    assert.equal(input.action,'put-mail');
    const parts=[];
    for await(const part of input.body) parts.push(part);
    received=Buffer.concat(parts);
    assert.equal(received.length,input.size);
    return {etag:'test'};
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const url='http://127.0.0.1:'+server.address().port+'/mail-attachments';
    const data=Buffer.from([0,255,255,33]);
    const headers={'content-type':'application/octet-stream','x-oss-object-key':mailKey};
    assert.equal((await fetch(url,{method:'PUT',headers,body:data})).status,200);
    assert.deepEqual(received,data);
    assert.equal((await fetch(url,{method:'PUT',headers:{...headers,'x-oss-object-key':mailKey.replace('dev/','prod/')},body:data})).status,400);
  } finally {await new Promise(resolve=>server.close(resolve));}
});
