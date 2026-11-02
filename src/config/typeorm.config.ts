import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { databaseSsl } from './database-ssl';

export function createTypeOrmOptions(
  config: ConfigService,
): TypeOrmModuleOptions {
  return {
    type: 'postgres',
    host: config.getOrThrow<string>('DATABASE_HOST'),
    port: Number(config.getOrThrow<string>('DATABASE_PORT')),
    database: config.getOrThrow<string>('DATABASE_NAME'),
    username: config.getOrThrow<string>('DATABASE_USER'),
    password: config.getOrThrow<string>('DATABASE_PASSWORD'),
    ssl: databaseSsl(
      config.get<string>('DATABASE_SSL'),
      config.get<string>('DATABASE_SSL_CA'),
    ),
    autoLoadEntities: true,
    synchronize: false,
    migrationsRun: false,
    // Raw query errors include bound values (including certificates); use sanitized HTTP errors.
    logging: false,
  };
}
