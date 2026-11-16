'use strict';
// Host-only OSS writer, isolated Unix socket per environment. No credential endpoint.
const http = require('node:http');
const fs = require('node:fs');
const OSS = require('ali-oss');
const Credentials = require('@alicloud/credentials').default;
const MAX = 5 * 1024 * 1024;
const MAX_DOCUMENT = 20 * 1024 * 1024;
const MIME_BY_EXTENSION = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
function documentMime(key, environment) {
  if (typeof key !== 'string' || !['dev', 'prod'].includes(environment)) return undefined;
  const uuid = '[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}';
  const match = new RegExp('^private/' + environment + '/whatsapp/' + uuid + '/' + uuid + '\\.(pdf|docx?)$').exec(key);
  return match && MIME_BY_EXTENSION[match[1]];
}
function validKey(key, environment) {
  return typeof key === 'string' && ['dev', 'prod'].includes(environment) &&
    new RegExp('^' + environment + '/(whatsapp|upload)/[a-f0-9-]{36}/(original\\.(jpg|png|webp|gif)|thumbnail\\.webp|send\\.jpg)$').test(key);
}
function validate(value, environment) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (value.action === 'delete') return Object.keys(value).every(k => ['action', 'keys'].includes(k)) &&
    Array.isArray(value.keys) && value.keys.length > 0 && value.keys.length <= 3 && value.keys.every(k => validKey(k, environment) || documentMime(k, environment));
  if (value.action === 'sign-document')
    return Object.keys(value).every(k => ['action', 'key', 'purpose', 'fileName'].includes(k)) &&
      !!documentMime(value.key, environment) && ['download', 'send'].includes(value.purpose) &&
      typeof value.fileName === 'string' && value.fileName.length <= 245 &&
      !/[\p{C}\\/]/u.test(value.fileName) &&
      value.fileName.toLowerCase().endsWith('.' + value.key.split('.').pop());
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
  let documentUploading = false;
  const server = http.createServer(async (req, res) => {
    const respond = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    const document = req.method === 'PUT' && req.url === '/documents';
    if (!document && (req.method !== 'POST' || req.url !== '/objects')) { respond(404, { error: 'NOT_FOUND' }); return; }
    if (document && documentUploading) { respond(429, { error: 'BUSY' }); return; }
    if (inflight >= 2) { respond(429, { error: 'BUSY' }); return; }
    inflight++;
    if (document) documentUploading = true;
    try {
      const key = req.headers['x-oss-object-key'];
      const mime = document && documentMime(key, config.environment);
      const contentLength = Number(req.headers['content-length']);
      if (document && (!mime || req.headers['content-type'] !== 'application/octet-stream' ||
          !Number.isSafeInteger(contentLength) || contentLength < 1 || contentLength > MAX_DOCUMENT)) {
        respond(400, { error: 'INVALID_DOCUMENT' }); return;
      }
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > (document ? contentLength : 7 * 1024 * 1024)) { respond(413, { error: 'TOO_LARGE' }); req.destroy(); return; }
        chunks.push(chunk);
      }
      if (document) {
        if (size !== contentLength) { respond(400, { error: 'INVALID_DOCUMENT' }); return; }
        respond(200, await execute({ action: 'put-document', key, mime, body: Buffer.concat(chunks) }));
        return;
      }
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!validate(value, config.environment)) { respond(400, { error: 'INVALID_OBJECT' }); return; }
      respond(200, await execute(value));
    } catch { respond(503, { error: 'OSS_UNAVAILABLE' }); }
    finally { inflight--; if (document) documentUploading = false; }
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
    const client = new OSS({ region: 'oss-cn-hangzhou', bucket: config.bucket, internal: value.action !== 'sign-document', secure: true,
      accessKeyId: c.accessKeyId, accessKeySecret: c.accessKeySecret, stsToken: c.securityToken, timeout: 30000 });
    if (value.action === 'delete') {
      for (const key of value.keys) await client.delete(key);
      return { deleted: true };
    }
    if (value.action === 'sign-document') {
      const expiresIn = value.purpose === 'download' ? 60 : 900;
      const queries = value.purpose === 'download' ? {
        'response-content-disposition': "attachment; filename*=UTF-8''" +
          encodeURIComponent(value.fileName).replace(/['()*]/g, char => '%' + char.charCodeAt(0).toString(16)),
      } : undefined;
      return { url: await client.signatureUrlV4('GET', expiresIn, { queries }, value.key) };
    }
    const privateDocument = value.action === 'put-document';
    const result = await client.put(value.key, privateDocument ? value.body : Buffer.from(value.body, 'base64'), { headers: {
      'Content-Type': value.mime, 'Cache-Control': privateDocument ? 'private, no-store' : 'public, max-age=300',
      'x-oss-server-side-encryption': 'AES256',
    } });
    return { etag: result.res.headers.etag };
  });
  if (fs.existsSync(config.socket)) fs.unlinkSync(config.socket);
  server.listen(config.socket, () => fs.chmodSync(config.socket, 0o660));
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}
module.exports = { validKey, validate, createRelay, main };
