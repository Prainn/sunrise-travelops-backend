'use strict';
// Host-only sender. The API receives send results, never instance credentials.
const http = require('node:http');
const fs = require('node:fs');
const CamsModule = require('@alicloud/cams20200606');
const Credentials = require('@alicloud/credentials').default;
const { $OpenApiUtil } = require('@alicloud/openapi-core');
const { RuntimeOptions } = require('@darabonba/typescript');

const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏', ''];
function validateLookup(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every(key => ['providerId', 'occurredAt'].includes(key)) &&
    typeof value.providerId === 'string' && value.providerId.length > 0 && value.providerId.length <= 1000 &&
    Number.isSafeInteger(value.occurredAt) && value.occurredAt > Date.now() - 31 * 86400000 && value.occurredAt <= Date.now() + 60000;
}
async function lookupMessageId(client, config, { providerId, occurredAt }) {
  for (let index = 1; index <= 3; index++) {
    const result = await client.listChatappMessageWithOptions(new CamsModule.ListChatappMessageRequest({
      channelType: 'WHATSAPP', custSpaceId: config.spaceId, businessNumber: config.phone,
      startTime: occurredAt - 60000, endTime: occurredAt + 60000, page: { index, size: 100 },
    }), new RuntimeOptions({ autoretry: false, maxAttempts: 1, connectTimeout: 2000, readTimeout: 3000 }));
    if (result.body?.code !== 'OK') return { found: false };
    const rows = result.body.data ?? [];
    const matched = rows.find(row => row.messageId === providerId && row.businessNumber === config.phone);
    if (matched) return typeof matched.uniqueMessageId === 'string' && /^wamid\.[A-Za-z0-9+/=_-]+$/.test(matched.uniqueMessageId)
      ? { found: true, messageId: matched.uniqueMessageId } : { found: false };
    if (rows.length < 100) break;
  }
  return { found: false };
}
function validateSend(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some((key) => !['recipient', 'text', 'taskId', 'reaction', 'contextMessageId'].includes(key)) ||
      typeof value.recipient !== 'string' || !/^(\d{5,20}|[A-Z]{2}\.[A-Za-z0-9.]+)$/.test(value.recipient) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.taskId) ||
      typeof value.text !== 'string' || value.text.length > 4096) return false;
  if (value.contextMessageId !== undefined &&
      (typeof value.contextMessageId !== 'string' || !value.contextMessageId.length || value.contextMessageId.length > 1000 || value.reaction !== undefined)) return false;
  if (value.reaction !== undefined) {
    const reaction = value.reaction;
    return !!reaction && typeof reaction === 'object' && !Array.isArray(reaction) &&
      Object.keys(reaction).every((key) => ['messageId', 'emoji'].includes(key)) &&
      typeof reaction.messageId === 'string' && /^wamid\.[A-Za-z0-9+/=_-]+$/.test(reaction.messageId) && reaction.messageId.length <= 1000 &&
      EMOJIS.includes(reaction.emoji) && reaction.emoji === value.text;
  }
  return value.text.trim().length > 0;
}

function createRelay(send, health, lookup) {
  return http.createServer(async (req, res) => {
    const respond = (status, value) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    if (req.method === 'GET' && req.url === '/health') {
      try { await health(); respond(200, { ready: true }); }
      catch { respond(503, { ready: false }); }
      return;
    }
    if (req.method !== 'POST' || !['/send', '/message-id'].includes(req.url)) {
      respond(404, { error: 'NOT_FOUND' }); return;
    }
    try {
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 32768) { respond(413, { error: 'TOO_LARGE' }); req.destroy(); return; }
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (req.url === '/message-id') {
        if (!lookup || !validateLookup(body)) { respond(400, { error: 'INVALID_LOOKUP' }); return; }
        try { respond(200, await lookup(body)); } catch { respond(200, { found: false }); }
        return;
      }
      if (!validateSend(body)) { respond(400, { error: 'INVALID_SEND' }); return; }
      respond(200, await send(body));
    } catch {
      // An interrupted request is never retried here. Preserve ambiguity upstream.
      respond(200, { status: 'unknown', errorCode: 'PROVIDER_RESULT_UNKNOWN' });
    }
  });
}

async function main() {
  const config = JSON.parse(fs.readFileSync('/etc/sunrise-whatsapp-send/config.json', 'utf8'));
  if (config.environment !== 'dev' || !config.spaceId || !/^\d{5,20}$/.test(config.phone) ||
      config.roleName !== 'sunrise-whatsapp-runtime') throw new Error('INVALID_CONFIG');
  const credential = new Credentials({ type: 'ecs_ram_role', roleName: config.roleName });
  const client = new CamsModule.default(new $OpenApiUtil.Config({
    credential, endpoint: 'cams.ap-southeast-1.aliyuncs.com',
  }));
  const server = createRelay(async ({ recipient, text, taskId, reaction, contextMessageId }) => {
    const result = await client.sendChatappMessageWithOptions(new CamsModule.SendChatappMessageRequest({
      channelType: 'whatsapp', type: 'message', messageType: reaction ? 'reaction' : 'text',
      custSpaceId: config.spaceId, from: config.phone, to: recipient,
      content: JSON.stringify(reaction ?? { text }), taskId, contextMessageId,
    }), new RuntimeOptions({ autoretry: false, maxAttempts: 1, connectTimeout: 5000, readTimeout: 10000 }));
    if (result.body?.code === 'OK' && result.body.messageId)
      return { status: 'accepted', providerId: result.body.messageId };
    if (result.body?.code && result.body.code !== 'OK')
      return { status: 'failed', errorCode: 'PROVIDER_REJECTED' };
    return { status: 'unknown', errorCode: 'PROVIDER_RESULT_UNKNOWN' };
  }, async () => {
    const value = await credential.getCredential();
    if (!value.accessKeyId || !value.accessKeySecret || !value.securityToken) throw new Error('CREDENTIAL_UNAVAILABLE');
  }, body => lookupMessageId(client, config, body));
  server.requestTimeout = 20000;
  server.headersTimeout = 10000;
  const socket = '/run/sunrise-whatsapp-send/send.sock';
  if (fs.existsSync(socket)) fs.unlinkSync(socket);
  server.listen(socket, () => fs.chmodSync(socket, 0o660));
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}
module.exports = { validateSend, validateLookup, lookupMessageId, createRelay, main };
