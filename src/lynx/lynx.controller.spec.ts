import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { LynxController } from './lynx.controller';
import { LynxVisit } from './lynx-visit.entity';
import { WhatsappRegistryService } from './whatsapp-registry.service';

describe('WhatsApp attribution registry HTTP contract', () => {
  let app: NestExpressApplication;
  const rows = new Map<string, LynxVisit>();
  const repository = {
    insert: jest.fn((data: Partial<LynxVisit>) => {
      if (rows.has(data.whatsappReference!)) {
        throw Object.assign(new Error('unique reference'), {
          driverError: {
            code: '23505',
            constraint: 'UQ_lynx_visits_whatsapp_reference',
          },
        });
      }
      rows.set(data.whatsappReference!, data as LynxVisit);
      return Promise.resolve();
    }),
    findOneBy: jest.fn(({ whatsappReference }: { whatsappReference: string }) =>
      Promise.resolve(rows.get(whatsappReference) ?? null),
    ),
  };
  const token = 'r'.repeat(40);
  const body = {
    whatsapp_reference: 'LX-ABC123',
    website_inquiry_id: 'wi-abc123',
    contract_version: 'v1',
    first_landing_page: 'https://lynxtour.cn/products/yunnan?gclid=secret#top',
    utm_source: 'google',
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [LynxController],
      providers: [
        WhatsappRegistryService,
        { provide: getRepositoryToken(LynxVisit), useValue: repository },
        { provide: ConfigService, useValue: { getOrThrow: () => token } },
      ],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>();
    app.setGlobalPrefix('api', {
      exclude: [
        { path: 'v1/whatsapp/register', method: RequestMethod.POST },
        {
          path: 'v1/private/whatsapp/:whatsapp_reference',
          method: RequestMethod.GET,
        },
      ],
    });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
  });
  beforeEach(() => {
    rows.clear();
    repository.insert.mockClear();
  });
  afterAll(async () => app.close());

  it('inserts once, accepts identical retry and rejects changed evidence', async () => {
    const http = app.getHttpServer();
    await request(http).post('/v1/whatsapp/register').send(body).expect(201);
    await request(http).post('/v1/whatsapp/register').send(body).expect(200);
    await request(http)
      .post('/v1/whatsapp/register')
      .send({ ...body, utm_source: 'facebook' })
      .expect(409);
    expect(rows.size).toBe(1);
    expect(rows.get(body.whatsapp_reference)?.utmSource).toBe('google');
    expect(rows.get(body.whatsapp_reference)?.firstLandingPage).toBe(
      body.first_landing_page,
    );
    expect(rows.get(body.whatsapp_reference)?.expiresAtUtc.getTime()).toBe(
      rows.get(body.whatsapp_reference)!.createdAtUtc.getTime() +
        180 * 86_400_000,
    );
  });

  it('accepts any non-empty contract version string within storage length', async () => {
    const http = app.getHttpServer();
    const customVersion = 'partner-contract-version-2026.09';
    await request(http)
      .post('/v1/whatsapp/register')
      .send({ ...body, contract_version: customVersion })
      .expect(201);
    expect(rows.get(body.whatsapp_reference)?.contractVersion).toBe(
      customVersion,
    );
  });

  it('matches the Lynxtour canonical fingerprint vector', async () => {
    const input = {
      whatsapp_reference: 'LX-23456789AB',
      website_inquiry_id: 'wi-12345678-1234-4abc-8def-1234567890ab',
      contract_version: 'lynxtour.whatsapp-attribution.v1',
      first_landing_page: 'https://www.lynxtour.cn/pages/start',
      utm_source: 'google',
      utm_medium: 'organic',
      utm_campaign: '',
      gbraid: '',
    };
    const http = app.getHttpServer();
    await request(http).post('/v1/whatsapp/register').send(input).expect(201);
    const stored = rows.get(input.whatsapp_reference)!;
    expect(stored.payloadFingerprint).toBe(
      'daf34eb2100e1402ae6a03bb54a2deed170db5fc7d63055654d8b1fb172e4278',
    );
    const found = await request(http)
      .get(`/v1/private/whatsapp/${input.whatsapp_reference}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const evidence = found.body as Record<string, unknown>;
    expect(evidence.payload_fingerprint).toBe(stored.payloadFingerprint);
    for (const field of [
      'external_referrer',
      'utm_term',
      'utm_content',
      'gclid',
      'wbraid',
    ]) {
      expect(evidence[field]).toBe('');
    }
    await request(http)
      .post('/v1/whatsapp/register')
      .send({ ...input, external_referrer: null, utm_term: '' })
      .expect(200);
  });

  it('uses canonical evidence for a stored record with legacy nulls and fingerprint', async () => {
    const http = app.getHttpServer();
    await request(http).post('/v1/whatsapp/register').send(body).expect(201);
    const stored = rows.get(body.whatsapp_reference)!;
    const canonicalFingerprint = stored.payloadFingerprint;
    stored.externalReferrer = null;
    stored.payloadFingerprint = '0'.repeat(64);
    await request(http).post('/v1/whatsapp/register').send(body).expect(200);
    const found = await request(http)
      .get(`/v1/private/whatsapp/${body.whatsapp_reference}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const evidence = found.body as Record<string, unknown>;
    expect(evidence.external_referrer).toBe('');
    expect(evidence.payload_fingerprint).toBe(canonicalFingerprint);
  });

  it('resolves exact unexpired evidence only with server token', async () => {
    const http = app.getHttpServer();
    await request(http).post('/v1/whatsapp/register').send(body).expect(201);
    const path = `/v1/private/whatsapp/${body.whatsapp_reference}`;
    await request(http).get(path).expect(401);
    await request(http)
      .get(path)
      .set('Authorization', 'Bearer wrong')
      .expect(401);
    const found = await request(http)
      .get(path)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(found.body).toMatchObject({
      whatsapp_reference: body.whatsapp_reference,
      first_landing_page: body.first_landing_page,
      utm_source: 'google',
      external_referrer: '',
      gclid: '',
    });
    const evidence = found.body as Record<string, unknown>;
    expect(evidence.created_at_utc).toMatch(/Z$/);
    expect(evidence.payload_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    await request(http)
      .get('/v1/private/whatsapp/LX-MISSING')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
    rows.get(body.whatsapp_reference)!.expiresAtUtc = new Date(Date.now() - 1);
    await request(http)
      .get(path)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('rejects unexpected fields and obvious PII before storing', async () => {
    const http = app.getHttpServer();
    await request(http)
      .post('/v1/whatsapp/register')
      .send({ ...body, browser: 'fake' })
      .expect(400);
    await request(http)
      .post('/v1/whatsapp/register')
      .send({ ...body, utm_campaign: 'person@example.com' })
      .expect(400);
    expect(rows.size).toBe(0);
  });
});
