import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import { InquiriesModule } from './inquiries/inquiries.module';
import { AuthModule } from './auth/auth.module';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { HttpLogContextInterceptor } from './common/interceptors/http-log-context.interceptor';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { PermissionsGuard } from './auth/guards/permissions.guard';
import { validateEnvironment } from './config/environment';
import { createTypeOrmOptions } from './config/typeorm.config';
import { createLoggerModuleOptions } from './config/logger';
import { HealthModule } from './health/health.module';
import { LynxModule } from './lynx/lynx.module';
import { LynxController } from './lynx/lynx.controller';
import { RolesModule } from './roles/roles.module';
import { ResourcesModule } from './resources/resources.module';
import { SystemModule } from './system/system.module';
import { UsersModule } from './users/users.module';
import { OperationLogsModule } from './operation-logs/operation-logs.module';
import { OperationLogInterceptor } from './operation-logs/operation-log.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.ENV_FILE ?? '.env',
      validate: validateEnvironment,
    }),
    LoggerModule.forRoot(createLoggerModuleOptions([LynxController])),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: createTypeOrmOptions,
    }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    AuthModule,
    InquiriesModule,
    UsersModule,
    OperationLogsModule,
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
    { provide: APP_INTERCEPTOR, useClass: HttpLogContextInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_INTERCEPTOR, useClass: OperationLogInterceptor },
  ],
})
export class AppModule {}
