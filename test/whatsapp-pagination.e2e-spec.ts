import { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { LynxController } from '../src/lynx/lynx.controller';
import { LynxVisit } from '../src/lynx/lynx-visit.entity';
import { WhatsappRegistryService } from '../src/lynx/whatsapp-registry.service';
import { createCorsOptions } from '../src/config/cors';

describe('Standalone WhatsApp pagination without a business database', () => {
  let app: INestApplication;
  const findAndCount = jest.fn();
  const findOneBy = jest.fn();
  const transaction = jest.fn(
    (_isolation: string, callback: (manager: unknown) => unknown) =>
      callback({ getRepository: () => ({ findAndCount }) }),
  );
  const record = {
    id: '00000000-0000-4000-8000-000000000001',
    whatsappReference: 'ref',
    websiteInquiryId: 'inquiry',
    contractVersion: 'v1',
    createdAtUtc: new Date('2026-01-01T00:00:00Z'),
    expiresAtUtc: new Date('2026-01-02T00:00:00Z'),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [LynxController],
      providers: [
        WhatsappRegistryService,
        {
          provide: ConfigService,
          useValue: { getOrThrow: () => 'test-token' },
        },
        {
          provide: getRepositoryToken(LynxVisit),
          useValue: { manager: { transaction }, findOneBy },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.enableCors(createCorsOptions(['https://business.example']));
    await app.init();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    findAndCount.mockResolvedValue([[record], 3]);
  });
  afterAll(async () => {
    await app.close();
  });
  const list = () =>
    request(app.getHttpServer() as Server).get('/v1/private/whatsapp');
  it('rejects missing, invalid and malformed tokens before reading data', async () => {
    await list().expect(401);
    await list().set('Authorization', 'Bearer wrong').expect(401);
    await list().set('Authorization', 'Basic wrong').expect(403);
    expect(transaction).not.toHaveBeenCalled();
  });
  it('defaults pagination and includes expired records with normalized fields', async () => {
    const response = await list()
      .set('Authorization', 'Bearer test-token')
      .set('Origin', 'https://business.example')
      .expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.body).toMatchObject({
      total: 3,
      page: 1,
      pageSize: 50,
      list: [
        {
          id: record.id,
          whatsapp_reference: 'ref',
          utm_source: '',
          expires_at_utc: '2026-01-02T00:00:00.000Z',
        },
      ],
    });
    expect(
      (response.body as { list: { payload_fingerprint: string }[] }).list[0]
        .payload_fingerprint,
    ).toMatch(/^[a-f0-9]{64}$/);
    expect(transaction).toHaveBeenCalledWith(
      'REPEATABLE READ',
      expect.any(Function),
    );
    expect(findAndCount).toHaveBeenCalledWith({
      order: { createdAtUtc: 'DESC', id: 'DESC' },
      skip: 0,
      take: 50,
    });
  });
  it('returns empty out-of-range pages and retains total', async () => {
    findAndCount.mockResolvedValue([[], 3]);
    const response = await list()
      .query({ page: 3, pageSize: 2 })
      .set('Authorization', 'Bearer test-token')
      .expect(200);
    expect(response.body).toEqual({ list: [], total: 3, page: 3, pageSize: 2 });
    expect(findAndCount).toHaveBeenCalledWith({
      order: { createdAtUtc: 'DESC', id: 'DESC' },
      skip: 4,
      take: 2,
    });
  });
  it.each([
    { page: 0 },
    { page: 1.5 },
    { page: 'abc' },
    { pageSize: 101 },
    { pageSize: 0 },
    { extra: 'x' },
  ])('rejects invalid query %j', async (query) => {
    await list()
      .query(query)
      .set('Authorization', 'Bearer test-token')
      .expect(400);
    expect(transaction).not.toHaveBeenCalled();
  });
  it('preserves single-record authentication and expiry', async () => {
    await request(app.getHttpServer() as Server)
      .get('/v1/private/whatsapp/ref')
      .expect(401);
    findOneBy.mockResolvedValue(record);
    await request(app.getHttpServer() as Server)
      .get('/v1/private/whatsapp/ref')
      .set('Authorization', 'Bearer test-token')
      .expect(404);
  });
});
