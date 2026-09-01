import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

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
    ssl:
      config.get<string>('DATABASE_SSL') === 'true'
        ? { rejectUnauthorized: true }
        : false,
    autoLoadEntities: true,
    synchronize: false,
    migrationsRun: false,
    logging:
      config.get<string>('NODE_ENV') === 'development' ? ['error'] : false,
  };
}
