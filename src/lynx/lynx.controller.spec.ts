import { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { LynxController } from './lynx.controller';
import { LynxVisit } from './lynx-visit.entity';

describe('GET /api/lynx', () => {
  let app: INestApplication;
  const insert = jest.fn().mockResolvedValue({});

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [LynxController],
      providers: [
        { provide: getRepositoryToken(LynxVisit), useValue: { insert } },
      ],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>();
    (app as NestExpressApplication).set('trust proxy', 'loopback');
    app.setGlobalPrefix('api');
    await app.init();
  });
  beforeEach(() => insert.mockClear());
  afterAll(async () => app.close());

  it('records each visit, accepts existing link parameters and derives IP and browser from the request', async () => {
    for (let i = 0; i < 2; i++) {
      await request(app.getHttpServer() as Server)
        .get('/api/lynx')
        .query({
          whatsapp_reference: 'LX-TEST',
          utm_source: 'test',
          ip: 'fake',
          browser: 'fake',
          time: 'fake',
        })
        .set('X-Forwarded-For', '116.53.208.174')
        .set('User-Agent', 'Mozilla/5.0 Chrome/152.0.0.0')
        .expect(200)
        .expect('Cache-Control', 'no-store')
        .expect({ recorded: true });
    }
    expect(insert).toHaveBeenCalledTimes(2);
    expect(insert).toHaveBeenLastCalledWith({
      whatsappReference: 'LX-TEST',
      ip: '116.53.208.174',
      browser: 'Mozilla/5.0 Chrome/152.0.0.0',
    });
  });

  it.each([
    '',
    '?whatsapp_reference=',
    '?whatsapp_reference=%20',
    '?whatsapp_reference=a&whatsapp_reference=b',
    `?whatsapp_reference=${'x'.repeat(129)}`,
  ])('rejects invalid reference %s without inserting', async (query) => {
    await request(app.getHttpServer() as Server)
      .get(`/api/lynx${query}`)
      .expect(400);
    expect(insert).not.toHaveBeenCalled();
  });

  it('does not acknowledge a failed database write', async () => {
    insert.mockRejectedValueOnce(new Error('Database unavailable'));
    app.useLogger(false);
    await request(app.getHttpServer() as Server)
      .get('/api/lynx?whatsapp_reference=LX-TEST')
      .expect(500);
  });
});
