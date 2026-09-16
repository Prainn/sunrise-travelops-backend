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
      'https://lynxtour.cn/products/yunnan',
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
      first_landing_page: 'https://lynxtour.cn/products/yunnan',
      utm_source: 'google',
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
