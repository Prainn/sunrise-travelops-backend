import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { Server } from 'node:http';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { ApiExceptionFilter } from '../common/filters/api-exception.filter';
import { createValidationException } from '../common/validation/validation-exception.factory';
import { InspectionAlertController } from './inspection-alert.controller';
import { InspectionAlertGuard } from './inspection-alert.guard';
import { InspectionAlertService } from './inspection-alert.service';

describe('inspection alert HTTP boundary', () => {
  let app: INestApplication;
  const report = jest.fn().mockResolvedValue({ result: 'sent' });
  const token = 'x'.repeat(32);
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
      ],
      controllers: [InspectionAlertController],
      providers: [
        InspectionAlertGuard,
        {
          provide: ConfigService,
          useValue: new ConfigService({
            INSPECTION_ALERT_ENABLED: 'true',
            INSPECTION_ALERT_TOKEN: token,
            INSPECTION_ALERT_RECIPIENT_USER_ID:
              'a5b9aa1a-821d-44d6-a999-cc377ebd2244',
          }),
        },
        { provide: InspectionAlertService, useValue: { report } },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        exceptionFactory: createValidationException,
      }),
    );
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
    await app.listen(0, '127.0.0.1');
  });
  afterAll(async () => app.close());
  it('requires the dedicated token and rejects arbitrary fields', async () => {
    const body = {
      eventId: 'a5b9aa1a-821d-44d6-a999-cc377ebd2244',
      checkedAt: '2026-10-28T10:00:00Z',
      environment: 'production',
      status: 'abnormal',
      severity: 'warning',
      item: 'disk',
      metricPercent: 95,
    };
    const server = app.getHttpServer() as Server;
    await request(server).post('/api/inspection-alerts').send(body).expect(401);
    await request(server)
      .post('/api/inspection-alerts')
      .set('Authorization', 'Bearer wrong')
      .send(body)
      .expect(401);
    await request(server)
      .post('/api/inspection-alerts')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...body, openId: 'ou_other', message: 'raw log' })
      .expect(400);
    expect(report).not.toHaveBeenCalled();
    await request(server)
      .post('/api/inspection-alerts')
      .set('Authorization', `Bearer ${token}`)
      .send(body)
      .expect(200);
    expect(report).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 26; i++) {
      await request(server)
        .post('/api/inspection-alerts')
        .set('Authorization', `Bearer ${token}`)
        .send(body)
        .expect(200);
    }
    await request(server)
      .post('/api/inspection-alerts')
      .set('Authorization', `Bearer ${token}`)
      .send(body)
      .expect(429);
  });
});
