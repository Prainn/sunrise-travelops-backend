import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { Server } from 'node:http';
import type { DataSource } from 'typeorm';
import type {
  DashboardTrend,
  DashboardSummary,
} from '../src/dashboard/dashboard.dto';
import request from 'supertest';
import type { AuthenticatedUser } from '../src/auth/auth.types';
import { AuthService } from '../src/auth/auth.service';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../src/auth/guards/permissions.guard';
import { JwtStrategy } from '../src/auth/jwt.strategy';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { createValidationException } from '../src/common/validation/validation-exception.factory';
import { DashboardController } from '../src/dashboard/dashboard.controller';
import { DashboardService } from '../src/dashboard/dashboard.service';
import { InquiriesService } from '../src/inquiries/inquiries.service';
import { GuideLeavesService } from '../src/tours/guide-leaves.service';
import { ToursService } from '../src/tours/tours.service';
import { WebsiteService } from '../src/website/website.service';

describe('Dashboard HTTP contract (no database)', () => {
  let app: INestApplication;
  let server: Server;
  let token: string;
  let current: AuthenticatedUser;
  const website = new WebsiteService({} as DataSource);
  // Real JWT strategy/guards, validation, controller, orchestrator and response envelope.
  // Only authenticated user lookup and source queries are replaced; no AppModule/env/DB.
  beforeAll(async () => {
    jest.spyOn(website, 'countByStatus').mockResolvedValue([]);
    jest.spyOn(website, 'countCreatedByDate').mockResolvedValue([]);
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'dashboard-http-test-only' })],
      controllers: [DashboardController],
      providers: [
        DashboardService,
        JwtStrategy,
        {
          provide: ConfigService,
          useValue: { getOrThrow: () => 'dashboard-http-test-only' },
        },
        {
          provide: AuthService,
          useValue: { getCurrentUser: () => Promise.resolve(current) },
        },
        {
          provide: InquiriesService,
          useValue: {
            actor: (user: AuthenticatedUser) => Promise.resolve(user),
            countByStatus: () => Promise.resolve([]),
            countCreatedByDate: () => Promise.resolve([]),
          },
        },
        {
          provide: WebsiteService,
          useValue: website,
        },
        {
          provide: ToursService,
          useValue: {
            countActive: () =>
              Promise.resolve({ active: 0, departingThisWeek: 0 }),
            countDeparturesByDate: () => Promise.resolve([]),
          },
        },
        {
          provide: GuideLeavesService,
          useValue: { countOnDate: () => Promise.resolve(0) },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useLogger(false);
    app.setGlobalPrefix('api');
    app.useGlobalGuards(
      new JwtAuthGuard(new Reflector()),
      new PermissionsGuard(new Reflector()),
    );
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
        exceptionFactory: createValidationException,
      }),
    );
    app.useGlobalFilters(new ApiExceptionFilter());
    app.useGlobalInterceptors(new ResponseInterceptor(new Reflector()));
    await app.init();
    server = app.getHttpServer() as Server;
    token = module.get(JwtService).sign({
      sub: 'actor',
      identityId: 'identity',
      scope: 'headquarters',
      type: 'access',
      menuKeys: [],
    });
  });
  beforeEach(() => {
    current = {
      id: 'actor',
      username: 'test',
      nickname: 'Test',
      identityId: 'identity',
      scope: 'headquarters',
      scopeName: '',
      deptId: null,
      deptName: '',
      roles: ['EXECUTIVE'],
      menuKeys: [],
      permissions: [],
    };
  });
  afterAll(async () => {
    await app.close();
    jest.restoreAllMocks();
  });

  it.each(['summary', 'trend'])(
    'requires authentication for %s',
    async (endpoint) => {
      const response = await request(server)
        .get(`/api/dashboard/${endpoint}`)
        .expect(401);
      expect(response.body).toMatchObject({
        code: 'AUTH_TOKEN_INVALID',
        data: null,
      });
    },
  );

  it('returns 200 with stable null fields when no source is permitted', async () => {
    const response = await request(server)
      .get('/api/dashboard/summary')
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(response.body).toEqual({
      code: 'SUCCESS',
      message: 'success',
      data: {
        inquiries: null,
        websiteInquiries: null,
        tours: null,
        guideLeavesToday: null,
      },
    });
    const trend = await request(server)
      .get('/api/dashboard/trend')
      .auth(token, { type: 'bearer' })
      .expect(200);
    const data = (trend.body as { data: DashboardTrend }).data;
    expect(data.dates).toHaveLength(7);
    expect(data.newInquiries).toBeNull();
    expect(data.departingTours).toBeNull();
  });

  it('serves accessible zero counts without requiring other list permissions', async () => {
    current.permissions = ['website:inquiry:list', 'resource:guide:list'];
    const response = await request(server)
      .get('/api/dashboard/summary')
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect((response.body as { data: DashboardSummary }).data).toEqual({
      inquiries: null,
      websiteInquiries: { new: 0, planning: 0, quoted: 0 },
      tours: null,
      guideLeavesToday: 0,
    });
    const trend = await request(server)
      .get('/api/dashboard/trend?days=30')
      .auth(token, { type: 'bearer' })
      .expect(200);
    const data = (trend.body as { data: DashboardTrend }).data;
    expect(data.dates).toHaveLength(30);
    expect(data.newInquiries).toEqual(Array(30).fill(0));
  });

  it.each([
    'days=0',
    'days=1',
    'days=8',
    'days=31',
    'days=',
    'days=abc',
    'days=7&days=30',
    'days=7&businessUnit=website',
    'scope=headquarters',
  ])('rejects invalid/extra query parameters: %s', async (query) => {
    const response = await request(server)
      .get(`/api/dashboard/trend?${query}`)
      .auth(token, { type: 'bearer' })
      .expect(400);
    expect(response.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      data: null,
    });
  });

  it('publishes both authenticated endpoints and nullable response schemas', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addBearerAuth().build(),
    );
    for (const endpoint of ['summary', 'trend']) {
      const operation = document.paths[`/api/dashboard/${endpoint}`]?.get;
      expect(operation?.security).toEqual([{ bearer: [] }]);
      expect(operation?.responses['200']).toBeDefined();
    }
    const schemas = document.components?.schemas;
    expect(schemas?.DashboardSummary).toMatchObject({
      properties: {
        inquiries: { nullable: true },
        guideLeavesToday: { nullable: true },
      },
    });
    expect(schemas?.DashboardTrend).toMatchObject({
      properties: {
        newInquiries: { nullable: true },
        departingTours: { nullable: true },
      },
    });
  });
});
