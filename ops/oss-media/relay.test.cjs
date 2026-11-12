'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validate } = require('./relay.cjs');
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
