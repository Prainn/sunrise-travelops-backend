const { createServer } = require('node:http');
const { readFileSync } = require('node:fs');
const { timingSafeEqual } = require('node:crypto');

const MAX_BODY = 1024 * 1024;
const MAX_REQUESTS = 4;
const stripPlus = (value) => typeof value === 'string' ? value.trim().replace(/^\+/, '') : '';

function selectEvents(body, kind, config) {
  const events = Array.isArray(body) ? body : [body];
  if (events.length > 100) return [];
  return events.filter((event) => {
    if (!event || typeof event !== 'object' || Array.isArray(event)) return false;
    const { NoticeType, From, To, OriginPhoneNumber, UserId, FromUserId, WabaId, CustSpaceId } = event;
    if (kind === 'inbound' && NoticeType && NoticeType !== 'inbound') return false;
    if (WabaId !== undefined && WabaId !== config.wabaId) return false;
    if (CustSpaceId !== undefined && CustSpaceId !== config.spaceId) return false;
    const status = kind === 'status';
    if ((status ? stripPlus(From) || stripPlus(OriginPhoneNumber) : stripPlus(To)) !== config.businessPhone) return false;
    const external = stripPlus(status ? To : From);
    const userId = status ? UserId : FromUserId;
    if (/^\d+$/.test(external)) return external === config.testPhone;
    return !!config.testBsuid && (external === config.testBsuid || (!external && userId === config.testBsuid));
  });
}

function createRelay(config, fetchDev = fetch) {
  const auth = Buffer.from(`Bearer ${config.mirrorToken}`);
  let active = 0;
  return createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') return res.writeHead(200).end('ok');
    const supplied = Buffer.from(req.headers.authorization || '');
    if (supplied.length !== auth.length || !timingSafeEqual(supplied, auth)) return res.writeHead(403).end();
    const kind = /^\/api\/whatsapp\/ingress\/(inbound|status)\/?$/i.exec(req.url.split('?')[0])?.[1].toLowerCase();
    if (!kind || req.method !== 'POST') return res.writeHead(404).end();
    if (active >= MAX_REQUESTS) return res.writeHead(503).end();
    active++;
    try {
      let length = 0;
      const chunks = [];
      for await (const chunk of req) {
        length += chunk.length;
        if (length > MAX_BODY) return res.writeHead(413).end();
        chunks.push(chunk);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return res.writeHead(400).end(); }
      const selected = selectEvents(body, kind, config);
      if (!selected.length) return res.writeHead(204).end();
      const response = await fetchDev(`http://sunrise-travelops-dev-api-1:4000/api/whatsapp/ingress/${kind}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${config.devToken}`, 'content-type': 'application/json' },
        body: JSON.stringify(selected),
        signal: AbortSignal.timeout(1800),
        redirect: 'error',
      });
      const delivered = response.ok && (await response.json()).code === 0;
      console.log(`mirror kind=${kind} count=${selected.length} delivered=${delivered}`);
      res.writeHead(delivered ? 204 : 502).end();
    } catch {
      console.warn(`mirror kind=${kind} delivered=false`);
      if (!res.headersSent) res.writeHead(502).end();
    } finally {
      active--;
    }
  });
}

if (require.main === module) {
  const config = JSON.parse(readFileSync('/app/dev-mirror-config.json', 'utf8'));
  if (!/^\d{5,20}$/.test(config.testPhone) || !/^\d{5,20}$/.test(config.businessPhone) ||
      !config.wabaId || !config.spaceId || config.mirrorToken?.length < 32 || config.devToken?.length < 32 ||
      typeof config.mirrorToken !== 'string' || typeof config.devToken !== 'string') throw new Error('Invalid dev mirror configuration');
  const server = createRelay(config);
  server.requestTimeout = 3000;
  server.headersTimeout = 2000;
  server.listen(8080, '0.0.0.0');
}

module.exports = { createRelay, selectEvents };
