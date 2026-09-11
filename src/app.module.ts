import { randomUUID } from 'node:crypto';
import { IncomingMessage } from 'node:http';
import { Module, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import { InquiriesModule } from './inquiries/inquiries.module';
import { AuthModule } from './auth/auth.module';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { PermissionsGuard } from './auth/guards/permissions.guard';
import { validateEnvironment } from './config/environment';
import { createTypeOrmOptions } from './config/typeorm.config';
import { HealthModule } from './health/health.module';
import { LynxModule } from './lynx/lynx.module';
import { RolesModule } from './roles/roles.module';
import { ResourcesModule } from './resources/resources.module';
import { SystemModule } from './system/system.module';
import { UsersModule } from './users/users.module';

const HIDDEN_NEST_STARTUP_LOG_CONTEXTS = new Set([
  'InstanceLoader',
  'RoutesResolver',
  'RouterExplorer',
]);

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.ENV_FILE ?? '.env',
      validate: validateEnvironment,
    }),
    LoggerModule.forRoot({
      forRoutes: [{ path: '{/*splat}', method: RequestMethod.ALL }],
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        transport:
          process.env.NODE_ENV === 'development'
            ? {
                target: 'pino-pretty',
                options: {
                  colorize: true,
                  ignore: 'pid,hostname,context,req,res,responseTime',
                  messageFormat: '{if context}[{context}] {end}{msg}',
                  singleLine: true,
                  translateTime: 'SYS:HH:MM:ss.l',
                },
              }
            : undefined,
        hooks: {
          logMethod(args, method) {
            const bindings = args[0];
            const context =
              typeof bindings === 'object' &&
              bindings !== null &&
              'context' in bindings
                ? bindings.context
                : undefined;

            if (
              typeof context === 'string' &&
              HIDDEN_NEST_STARTUP_LOG_CONTEXTS.has(context)
            ) {
              return;
            }

            method.apply(this, args);
          },
        },
        genReqId: (request: IncomingMessage) =>
          request.headers['x-request-id']?.toString() ?? randomUUID(),
        customSuccessMessage: (request, response, responseTime) => {
          const requestId =
            typeof request.id === 'string' || typeof request.id === 'number'
              ? request.id
              : '-';

          return `[HTTP] ${request.method ?? '-'} ${request.url ?? '-'} ${response.statusCode} ${responseTime}ms [requestId=${requestId}]`;
        },
        redact: {
          paths: [
            'req.headers.authorization',
            'req.body.password',
            'req.body.refreshToken',
            'res.headers["set-cookie"]',
          ],
          censor: '[REDACTED]',
        },
      },
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: createTypeOrmOptions,
    }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    AuthModule,
    InquiriesModule,
    UsersModule,
    RolesModule,
    ResourcesModule,
    SystemModule,
    HealthModule,
    LynxModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
})
export class AppModule {}
