import { Controller, Get } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createCorsOptions } from './cors';

@Controller('api')
class TestController {
  @Get(['health', 'lynx', 'inquiries'])
  get() {
    return { ok: true };
  }
}

describe('route-scoped Lynxtour CORS', () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [TestController],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>();
    app.enableCors(createCorsOptions(['https://ops-dev.sunrisevacation.cn']));
    await app.init();
  });
  afterAll(async () => app.close());

  it.each(['https://lynxtour.cn', 'https://www.lynxtour.cn'])(
    'allows %s only on public integration endpoints',
    async (origin) => {
      for (const path of ['/api/health', '/api/lynx', '/api/lynx/']) {
        const res = await request(app.getHttpServer())
          .get(path)
          .set('Origin', origin)
          .expect(200);
        expect(res.headers['access-control-allow-origin']).toBe(origin);
        expect(res.headers.vary).toContain('Origin');
        expect(res.headers['access-control-allow-credentials']).toBeUndefined();
      }
      const business = await request(app.getHttpServer())
        .get('/api/inquiries')
        .set('Origin', origin);
      expect(business.headers['access-control-allow-origin']).toBeUndefined();
    },
  );

  it('answers JSON POST preflight', async () => {
    const res = await request(app.getHttpServer())
      .options('/api/lynx')
      .set('Origin', 'https://lynxtour.cn')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'Content-Type')
      .expect(204);
    expect(res.headers['access-control-allow-origin']).toBe(
      'https://lynxtour.cn',
    );
    expect(res.headers['access-control-allow-methods']).toBe(
      'GET,POST,OPTIONS',
    );
    expect(res.headers['access-control-allow-headers']).toBe('Content-Type');
    expect(res.headers.vary).toContain('Origin');
  });

  it('preserves existing business origin and credentials policy', async () => {
    for (const path of ['/api/inquiries', '/api/health']) {
      const res = await request(app.getHttpServer())
        .get(path)
        .set('Origin', 'https://ops-dev.sunrisevacation.cn');
      expect(res.headers['access-control-allow-origin']).toBe(
        'https://ops-dev.sunrisevacation.cn',
      );
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    }
    const res = await request(app.getHttpServer())
      .get('/api/lynx')
      .set('Origin', 'https://lynxtour.cn.evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
