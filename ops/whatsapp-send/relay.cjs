'use strict';
// Host-only sender. The API receives send results, never instance credentials.
const http = require('node:http');
const fs = require('node:fs');
const CamsModule = require('@alicloud/cams20200606');
const Credentials = require('@alicloud/credentials').default;
const { $OpenApiUtil } = require('@alicloud/openapi-core');
const { RuntimeOptions } = require('@darabonba/typescript');

const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏', ''];
function validateSend(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some((key) => !['recipient', 'text', 'taskId', 'reaction'].includes(key)) ||
      typeof value.recipient !== 'string' || !/^(\d{5,20}|[A-Z]{2}\.[A-Za-z0-9.]+)$/.test(value.recipient) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.taskId) ||
      typeof value.text !== 'string' || value.text.length > 4096) return false;
  if (value.reaction !== undefined) {
    const reaction = value.reaction;
    return !!reaction && typeof reaction === 'object' && !Array.isArray(reaction) &&
      Object.keys(reaction).every((key) => ['messageId', 'emoji'].includes(key)) &&
      typeof reaction.messageId === 'string' && reaction.messageId.length > 0 && reaction.messageId.length <= 1000 &&
      EMOJIS.includes(reaction.emoji) && reaction.emoji === value.text;
  }
  return value.text.trim().length > 0;
}

function createRelay(send, health) {
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
    if (req.method !== 'POST' || req.url !== '/send') {
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
  const server = createRelay(async ({ recipient, text, taskId, reaction }) => {
    const result = await client.sendChatappMessageWithOptions(new CamsModule.SendChatappMessageRequest({
      channelType: 'whatsapp', type: 'message', messageType: reaction ? 'reaction' : 'text',
      custSpaceId: config.spaceId, from: config.phone, to: recipient,
      content: JSON.stringify(reaction ?? { text }), taskId,
    }), new RuntimeOptions({ autoretry: false, maxAttempts: 1, connectTimeout: 5000, readTimeout: 10000 }));
    if (result.body?.code === 'OK' && result.body.messageId)
      return { status: 'accepted', providerId: result.body.messageId };
    if (result.body?.code && result.body.code !== 'OK')
      return { status: 'failed', errorCode: 'PROVIDER_REJECTED' };
    return { status: 'unknown', errorCode: 'PROVIDER_RESULT_UNKNOWN' };
  }, async () => {
    const value = await credential.getCredential();
    if (!value.accessKeyId || !value.accessKeySecret || !value.securityToken) throw new Error('CREDENTIAL_UNAVAILABLE');
  });
  server.requestTimeout = 20000;
  server.headersTimeout = 10000;
  const socket = '/run/sunrise-whatsapp-send/send.sock';
  if (fs.existsSync(socket)) fs.unlinkSync(socket);
  server.listen(socket, () => fs.chmodSync(socket, 0o660));
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}
module.exports = { validateSend, createRelay, main };
