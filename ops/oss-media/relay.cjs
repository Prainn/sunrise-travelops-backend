'use strict';
// Host-only OSS writer, isolated Unix socket per environment. No credential endpoint.
const http = require('node:http');
const fs = require('node:fs');
const OSS = require('ali-oss');
const Credentials = require('@alicloud/credentials').default;
const MAX = 5 * 1024 * 1024;
function validKey(key, environment) {
  return typeof key === 'string' && ['dev', 'prod'].includes(environment) &&
    new RegExp('^' + environment + '/whatsapp/[a-f0-9-]{36}/(original\\.(jpg|png|webp|gif)|thumbnail\\.webp|send\\.jpg)$').test(key);
}
function validate(value, environment) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (value.action === 'delete') return Object.keys(value).every(k => ['action', 'keys'].includes(k)) &&
    Array.isArray(value.keys) && value.keys.length > 0 && value.keys.length <= 3 && value.keys.every(k => validKey(k, environment));
  if (value.action !== 'put' || Object.keys(value).some(k => !['action', 'key', 'body', 'mime'].includes(k)) ||
      !validKey(value.key, environment) || typeof value.body !== 'string' ||
      !value.body.length || value.body.length > Math.ceil(MAX / 3) * 4 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(value.body)) return false;
  const bytes = Buffer.from(value.body, 'base64');
  const mime = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' }[value.key.split('.').pop()];
  return value.mime === mime && bytes.length > 0 && bytes.length <= MAX && bytes.toString('base64') === value.body;
}
function createRelay(config, execute) {
  let inflight = 0;
  const server = http.createServer(async (req, res) => {
    const respond = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.method !== 'POST' || req.url !== '/objects') { respond(404, { error: 'NOT_FOUND' }); return; }
    if (inflight >= 2) { respond(429, { error: 'BUSY' }); return; }
    inflight++;
    try {
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 7 * 1024 * 1024) { respond(413, { error: 'TOO_LARGE' }); req.destroy(); return; }
        chunks.push(chunk);
      }
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!validate(value, config.environment)) { respond(400, { error: 'INVALID_OBJECT' }); return; }
      respond(200, await execute(value));
    } catch { respond(503, { error: 'OSS_UNAVAILABLE' }); }
    finally { inflight--; }
  });
  server.requestTimeout = 45000;
  server.headersTimeout = 10000;
  return server;
}
async function main() {
  const config = JSON.parse(fs.readFileSync(process.env.OSS_RELAY_CONFIG || '/etc/sunrise-oss-dev/config.json', 'utf8'));
  if (!['dev', 'prod'].includes(config.environment) || config.bucket !== 'sunrise-travelops-media' ||
      config.roleName !== 'sunrise-whatsapp-runtime' || config.socket !== `/run/sunrise-oss-${config.environment}/oss.sock`) throw new Error('INVALID_CONFIG');
  const credential = new Credentials({ type: 'ecs_ram_role', roleName: config.roleName });
  const server = createRelay(config, async value => {
    // Credential provider caches/refreshes STS; never return its data over the socket.
    const c = await credential.getCredential();
    const client = new OSS({ region: 'oss-cn-hangzhou', bucket: config.bucket, internal: true, secure: true,
      accessKeyId: c.accessKeyId, accessKeySecret: c.accessKeySecret, stsToken: c.securityToken, timeout: 30000 });
    if (value.action === 'delete') {
      for (const key of value.keys) await client.delete(key);
      return { deleted: true };
    }
    const result = await client.put(value.key, Buffer.from(value.body, 'base64'), { headers: {
      'Content-Type': value.mime, 'Cache-Control': 'public, max-age=300', 'x-oss-server-side-encryption': 'AES256',
    } });
    return { etag: result.res.headers.etag };
  });
  if (fs.existsSync(config.socket)) fs.unlinkSync(config.socket);
  server.listen(config.socket, () => fs.chmodSync(config.socket, 0o660));
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}
module.exports = { validKey, validate, createRelay, main };
