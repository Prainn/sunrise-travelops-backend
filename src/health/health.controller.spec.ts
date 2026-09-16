import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';
import request from 'supertest';
import { HealthController } from './health.controller';

describe('existing /api/health contract', () => {
  let app: NestExpressApplication;
  const pingCheck = jest.fn().mockResolvedValue({ postgres: { status: 'up' } });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthCheckService,
          useValue: {
            check: async (checks: Array<() => Promise<unknown>>) => {
              const results = await Promise.all(
                checks.map(
                  (check) => check() as Promise<Record<string, unknown>>,
                ),
              );
              return {
                status: 'ok',
                details: { ...results[0], ...results[1] },
              };
            },
          },
        },
        { provide: TypeOrmHealthIndicator, useValue: { pingCheck } },
      ],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>();
    app.setGlobalPrefix('api');
    await app.init();
  });
  afterAll(async () => app.close());

  it('returns 200 only after checking service and database', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/health')
      .expect(200);
    const payload: unknown = response.body;
    expect(payload).toMatchObject({
      details: {
        api: { status: 'up' },
        postgres: { status: 'up' },
      },
    });
    expect(pingCheck).toHaveBeenCalledWith('postgres');
  });
});
