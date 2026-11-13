'use strict';
// Host-only Certbot hooks. Uses the ECS role; never exposes credentials to the API.
const fs = require('node:fs');
const tls = require('node:tls');
const dns = require('node:dns').promises;
const { X509Certificate, createPrivateKey } = require('node:crypto');
const Credentials = require('@alicloud/credentials').default;
const OpenApi = require('@alicloud/openapi-client');
const { RuntimeOptions } = require('@alicloud/tea-util');
const DOMAIN = 'media.sunrisevacation.cn';
const LINEAGE = '/etc/letsencrypt/live/' + DOMAIN;
const ZONE = 'acme-media.sunrisevacation.cn';

function challenge(env) {
  if (env.CERTBOT_DOMAIN !== DOMAIN || !/^[A-Za-z0-9_-]{43}$/.test(env.CERTBOT_VALIDATION || '')) throw new Error('INVALID_CHALLENGE');
  return { rr: '_acme-challenge', value: env.CERTBOT_VALIDATION };
}
async function rpc(credential, service, action, body) {
  const client = new OpenApi.default(new OpenApi.Config({ endpoint: service + '.aliyuncs.com', credential }));
  const result = await client.callApi(new OpenApi.Params({ action, version: service === 'cdn' ? '2018-05-10' : '2015-01-09',
    protocol: 'HTTPS', pathname: '/', method: 'POST', authType: 'AK', style: 'RPC', reqBodyType: 'formData', bodyType: 'json' }),
  new OpenApi.OpenApiRequest({ body }),
  new RuntimeOptions({ autoretry: false, connectTimeout: 10000, readTimeout: 30000 }));
  if (!result.body?.RequestId) throw new Error('API_RESULT_UNCONFIRMED');
  return result.body;
}
function certificate(pem, key) {
  const cert = new X509Certificate(pem);
  if (cert.checkHost(DOMAIN, { wildcards: false }) !== DOMAIN ||
      /staging|fake|pretend/i.test(cert.issuer) || !/Let's Encrypt/.test(cert.issuer) ||
      Date.parse(cert.validTo) < Date.now() + 86400000 || Date.parse(cert.validFrom) > Date.now() ||
      !cert.checkPrivateKey(createPrivateKey(key))) throw new Error('INVALID_CERTIFICATE');
  return cert;
}
function servedFingerprint() {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: DOMAIN, port: 443, servername: DOMAIN, rejectUnauthorized: true }, () => {
      const fingerprint = socket.getPeerCertificate().fingerprint256;
      socket.end(); resolve(fingerprint);
    });
    socket.setTimeout(15000, () => socket.destroy(new Error('TLS_TIMEOUT')));
    socket.on('error', reject);
  });
}
async function main(mode, env = process.env) {
  const credential = new Credentials({ type: 'ecs_ram_role', roleName: 'sunrise-whatsapp-runtime' });
  if (mode === 'auth' || mode === 'cleanup') {
    const value = challenge(env);
    const listed = await rpc(credential, 'alidns', 'DescribeDomainRecords', {
      DomainName: ZONE, RRKeyWord: value.rr, Type: 'TXT', PageSize: 100,
    });
    const matches = (listed.DomainRecords?.Record || []).filter(r => r.RR === value.rr && r.Type === 'TXT' && r.Value === value.value);
    if (mode === 'cleanup') {
      for (const record of matches) await rpc(credential, 'alidns', 'DeleteDomainRecord', { RecordId: record.RecordId });
      return;
    }
    if (!matches.length) await rpc(credential, 'alidns', 'AddDomainRecord', {
      DomainName: ZONE, RR: value.rr, Type: 'TXT', Value: value.value, TTL: 600,
    });
    // Check the delegated challenge from independent recursive resolvers.
    const resolvers = ['223.5.5.5', '1.1.1.1'].map(server => {
      const resolver = new dns.Resolver({ timeout: 5000, tries: 1 }); resolver.setServers([server]); return resolver;
    });
    for (let attempt = 0; attempt < 45; attempt++) {
      const results = await Promise.all(resolvers.map(async resolver => {
        try { return (await resolver.resolveTxt('_acme-challenge.' + DOMAIN)).some(row => row.join('') === value.value); }
        catch { return false; }
      }));
      if (results.every(Boolean)) return;
      if (attempt < 44) await new Promise(resolve => setTimeout(resolve, 20000));
    }
    throw new Error('DNS_NOT_PROPAGATED');
  }
  if (mode !== 'sync') throw new Error('INVALID_MODE');
  if (env.RENEWED_LINEAGE && env.RENEWED_LINEAGE !== LINEAGE) return;
  const pem = fs.readFileSync(LINEAGE + '/fullchain.pem', 'utf8');
  const key = fs.readFileSync(LINEAGE + '/privkey.pem', 'utf8');
  const cert = certificate(pem, key);
  if (await servedFingerprint().catch(() => null) === cert.fingerprint256) {
    console.log('CDN certificate matches local certificate'); return;
  }
  await rpc(credential, 'cdn', 'SetCdnDomainSSLCertificate', { DomainName: DOMAIN, CertType: 'upload', SSLProtocol: 'on',
    CertName: 'media-le-' + cert.serialNumber.toLowerCase(), SSLPub: pem, SSLPri: key });
  console.log('CDN certificate update accepted; public TLS will be checked on the next run');
}
module.exports = { challenge, certificate, main };
if (require.main === module) main(process.argv[2]).catch(error => {
  // SDK errors may contain request data. Never print raw errors or private keys.
  console.error('Media certificate operation failed:', /^[A-Za-z0-9_.-]{1,100}$/.test(error.code || '') ? error.code : 'OPERATION_FAILED');
  process.exitCode = 1;
});
