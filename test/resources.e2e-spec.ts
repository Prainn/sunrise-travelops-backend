import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Server } from 'node:http';
import { AuthService } from '../src/auth/auth.service';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../src/auth/guards/permissions.guard';
import { JwtStrategy } from '../src/auth/jwt.strategy';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter';
import { HotelsController } from '../src/resources/hotels/hotels.controller';
import { HotelsService } from '../src/resources/hotels/hotels.service';
import { RestaurantsController } from '../src/resources/restaurants/restaurants.controller';
import { RestaurantsService } from '../src/resources/restaurants/restaurants.service';

describe('Resources API authorization (e2e)', () => {
  const uuidV5 = '448b98de-ff5f-55a4-b524-0d1d01511db9';
  let app: INestApplication;
  let server: Server;
  let jwt: JwtService;
  const permissions: string[] = [];

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              JWT_SECRET: 'test-access-secret-that-is-at-least-32-characters',
            }),
          ],
        }),
        PassportModule,
        JwtModule.register({}),
      ],
      controllers: [HotelsController, RestaurantsController],
      providers: [
        JwtStrategy,
        {
          provide: AuthService,
          useValue: {
            getCurrentUser: jest.fn().mockImplementation(() =>
              Promise.resolve({
                id: '00000000-0000-4000-8000-000000000001',
                username: 'resource-user',
                permissions: [...permissions],
              }),
            ),
          },
        },
        {
          provide: HotelsService,
          useValue: {
            list: jest.fn().mockResolvedValue({
              list: [],
              total: 0,
              page: 1,
              pageSize: 20,
            }),
          },
        },
        {
          provide: RestaurantsService,
          useValue: {
            listPrices: jest.fn().mockResolvedValue([]),
          },
        },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
    server = app.getHttpServer() as Server;
    jwt = app.get(JwtService);
  });

  afterAll(async () => app.close());

  it('requires a bearer token and the resource list permission', async () => {
    await request(server).get('/api/resources/hotels').expect(401);

    const token = await jwt.signAsync(
      { sub: '00000000-0000-4000-8000-000000000001', type: 'access' },
      { secret: 'test-access-secret-that-is-at-least-32-characters' },
    );
    const denied = await request(server)
      .get('/api/resources/hotels')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    expect(denied.body).toMatchObject({ code: 'PERMISSION_DENIED' });

    permissions.push('resource:hotel:list');
    await request(server)
      .get('/api/resources/hotels')
      .set('Authorization', `Bearer ${token}`)
      .expect(200, { list: [], total: 0, page: 1, pageSize: 20 });
  });

  it('accepts an existing UUID v5 parent id for a child-resource route', async () => {
    if (!permissions.includes('resource:restaurant:list')) {
      permissions.push('resource:restaurant:list');
    }
    const token = await jwt.signAsync(
      { sub: '00000000-0000-4000-8000-000000000001', type: 'access' },
      { secret: 'test-access-secret-that-is-at-least-32-characters' },
    );

    await request(server)
      .get(`/api/resources/restaurants/${uuidV5}/prices`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200, []);
  });
});
