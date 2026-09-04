import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { HotelsController } from '../../resources/hotels/hotels.controller';
import { HotelsService } from '../../resources/hotels/hotels.service';

describe('Swagger API response contract', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [HotelsController],
      providers: [{ provide: HotelsService, useValue: {} }],
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
});
