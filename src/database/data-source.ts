import 'reflect-metadata';
import { config as loadEnvironment } from 'dotenv';
import { DataSource } from 'typeorm';

loadEnvironment();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export default new DataSource({
  type: 'postgres',
  host: required('DATABASE_HOST'),
  port: Number(required('DATABASE_PORT')),
  database: required('DATABASE_NAME'),
  username: required('DATABASE_USER'),
  password: required('DATABASE_PASSWORD'),
  ssl:
    process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : false,
  entities: [`${__dirname}/../**/*.entity.{ts,js}`],
  migrations: [`${__dirname}/../migrations/*.{ts,js}`],
  synchronize: false,
});
