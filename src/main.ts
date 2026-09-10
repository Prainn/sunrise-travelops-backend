import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { createCorsOptions } from './config/cors';
import { ApiExceptionFilter } from './common/filters/api-exception.filter';
import { createValidationException } from './common/validation/validation-exception.factory';
import { parseCorsOrigins, parseTrustProxy } from './config/environment';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  const config = app.get(ConfigService);

  app.useLogger(app.get(Logger));
  app.set('trust proxy', parseTrustProxy(config.get<string>('TRUST_PROXY')));
  app.setGlobalPrefix('api');
  app.useBodyParser('json', { limit: '2mb' });
  app.use(helmet());
  app.enableCors(
    createCorsOptions(
      parseCorsOrigins(config.getOrThrow<string>('CORS_ORIGIN')),
    ),
  );
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: createValidationException,
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Sunrise TravelOps API')
    .setDescription('Sunrise TravelOps V1 backend API')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup(
    'api/docs',
    app,
    SwaggerModule.createDocument(app, swaggerConfig),
  );

  await app.listen(Number(config.get<string>('PORT') ?? 4000), '0.0.0.0');
}

void bootstrap();
