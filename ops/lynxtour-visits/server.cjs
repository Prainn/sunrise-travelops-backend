'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { Pool } = require('pg');
const pool = new Pool({ host: process.env.PGHOST, database: 'travelops_dev', user: 'lynxtour_viewer', password: process.env.PGPASSWORD, max: 3, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, options: '-c default_transaction_read_only=on -c statement_timeout=5000' });
const passwordHash = Buffer.from(process.env.AUTH_HASH, 'hex');
const files = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'] };
const attempts = new Map();
function exportRange(search) {
  const start = search.get('start'), end = search.get('end');
  const valid = value => /^[1-9]\d{3}-\d{2}-\d{2}$/.test(value || '') &&
    Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)) &&
    new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
  if (!valid(start) || !valid(end) || start > end) return null;
  return [new Date(`${start}T00:00:00.000+08:00`), new Date(Date.parse(`${end}T00:00:00.000+08:00`) + 86400000)];
}
function csvCell(value) {
  let text = value == null ? '' : value instanceof Date ? value.toISOString() : String(value);
  // Prevent spreadsheet applications from interpreting attribution text as formulas.
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
async function exportCsv(req, res, url) {
  const range = exportRange(url.searchParams);
  if (!range) { send(res, 400, '{"error":"请选择有效的开始和结束日期，结束日期不能早于开始日期"}'); return; }
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query('DECLARE export_visits NO SCROLL CURSOR FOR SELECT * FROM public.lynx_visits WHERE created_at_utc >= $1 AND created_at_utc < $2 ORDER BY created_at_utc DESC, id DESC', range);
    const first = await client.query('FETCH FORWARD 500 FROM export_visits');
    const columns = first.fields.map(field => field.name);
    async function* chunks() {
      yield '\uFEFF' + columns.map(csvCell).join(',') + '\r\n';
      let batch = first;
      while (batch.rows.length) {
        for (const row of batch.rows) yield columns.map(column => csvCell(row[column])).join(',') + '\r\n';
        batch = await client.query('FETCH FORWARD 500 FROM export_visits');
      }
      await client.query('COMMIT');
    }
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="lynxtour-visits_${url.searchParams.get('start')}_${url.searchParams.get('end')}.csv"`,
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    });
    await pipeline(Readable.from(chunks()), res);
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('Export failed:', error.code || 'unknown');
    if (!res.headersSent) send(res, 503, '{"error":"导出失败，请稍后重试"}');
    else res.destroy();
  } finally { if (client) client.release(); }
}
function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'", 'Referrer-Policy': 'no-referrer', ...extra });
  res.end(body);
}
function authenticate(req, res) {
  const ip = req.headers['x-real-ip'] || req.socket.remoteAddress;
  const now = Date.now();
  if (attempts.size > 10000) for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
  const record = attempts.get(ip);
  if (record && record.until > now && record.count >= 10) { send(res, 429, '{"error":"登录尝试过多，请稍后重试"}', undefined, { 'Retry-After': '60' }); return false; }
  const authorization = req.headers.authorization || '';
  let valid = false;
  if (authorization.startsWith('Basic ') && authorization.length < 2048) {
    const decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
    const index = decoded.indexOf(':');
    if (index >= 0) {
      const digest = crypto.scryptSync(decoded.slice(index + 1), process.env.AUTH_SALT, 32);
      valid = crypto.timingSafeEqual(digest, passwordHash) && decoded.slice(0, index) === process.env.AUTH_USER;
    }
  }
  if (valid) { attempts.delete(ip); return true; }
  if (authorization) attempts.set(ip, { count: record && record.until > now ? record.count + 1 : 1, until: record && record.until > now ? record.until : now + 60000 });
  send(res, 401, 'Authentication required', 'text/plain; charset=utf-8', { 'WWW-Authenticate': 'Basic realm="Lynxtour", charset="UTF-8"' });
  return false;
}
http.createServer(async (req, res) => {
  if (!authenticate(req, res)) return;
  if (req.method !== 'GET') { send(res, 405, '{"error":"只支持读取"}', undefined, { Allow: 'GET' }); return; }
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/visits.csv') { await exportCsv(req, res, url); return; }
  if (files[url.pathname]) {
    const [file, type] = files[url.pathname];
    send(res, 200, fs.readFileSync(path.join(__dirname, file)), type); return;
  }
  if (url.pathname !== '/api/visits') { send(res, 404, '{"error":"不存在"}'); return; }
  const pageText = url.searchParams.get('page') || '1';
  if (!/^[1-9]\d{0,5}$/.test(pageText)) { send(res, 400, '{"error":"页码无效"}'); return; }
  const page = Number(pageText), pageSize = 50;
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const count = await client.query('SELECT count(*)::text AS total FROM public.lynx_visits');
    const result = await client.query('SELECT * FROM public.lynx_visits ORDER BY created_at_utc DESC, id DESC LIMIT $1 OFFSET $2', [pageSize, (page - 1) * pageSize]);
    await client.query('COMMIT');
    send(res, 200, JSON.stringify({ columns: result.fields.map(field => field.name), rows: result.rows, total: Number(count.rows[0].total), page, pageSize }));
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('Read failed:', error.code || 'unknown');
    send(res, 503, '{"error":"暂时无法读取数据，请稍后刷新"}');
  } finally { if (client) client.release(); }
}).listen(4080, '0.0.0.0');
process.on('SIGTERM', () => pool.end().finally(() => process.exit(0)));
