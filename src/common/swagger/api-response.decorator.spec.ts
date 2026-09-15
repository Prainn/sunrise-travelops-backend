import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { HotelsController } from '../../resources/hotels/hotels.controller';
import { HotelsService } from '../../resources/hotels/hotels.service';
import { UserManagementController } from '../../users/user-management.controller';
import { UserManagementService } from '../../users/user-management.service';

describe('Swagger API response contract', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [HotelsController, UserManagementController],
      providers: [
        { provide: HotelsService, useValue: {} },
        { provide: UserManagementService, useValue: {} },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => app.close());

  it('documents success envelopes, pagination, and standard errors', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Contract test').setVersion('1').build(),
    );
    const operation = document.paths['/api/resources/hotels']?.get;

    expect(operation?.responses?.['200']).toMatchObject({
      content: {
        'application/json': {
          schema: {
            allOf: [
              { $ref: '#/components/schemas/ApiResponse' },
              expect.any(Object),
            ],
          },
        },
      },
    });
    expect(operation?.responses?.['400']).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/ApiErrorResponse' },
        },
      },
    });
    expect(Object.keys(document.components?.schemas ?? {})).toEqual(
      expect.arrayContaining([
        'ApiResponse',
        'ApiErrorResponse',
        'PageResult',
        'HotelResponse',
      ]),
    );
  });

  it('generates user response schemas with typed identities', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Contract test').setVersion('1').build(),
    );
    const schemas = document.components?.schemas;

    for (const name of ['UserItemResponse', 'CreatedUserResponse']) {
      expect(schemas?.[name]).toMatchObject({
        properties: {
          identities: {
            type: 'array',
            items: { $ref: '#/components/schemas/UserIdentityResponse' },
          },
        },
      });
    }
    expect(schemas?.UserIdentityResponse).toMatchObject({
      properties: {
        id: { type: 'string', format: 'uuid' },
        scope: {
          enum: ['headquarters', 'shengxu', 'linxi', 'website'],
        },
        deptId: { type: 'number', nullable: true },
        deptName: { type: 'string' },
        roleIds: { type: 'array', items: { type: 'string' } },
        roleNames: { type: 'string' },
      },
    });
  });
});
