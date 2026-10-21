import { HttpStatus, Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, QueryRunner } from 'typeorm';
import { BusinessException } from '../common/exceptions/business.exception';

export const VISIT_COLUMNS = [
  'id',
  'whatsapp_reference',
  'website_inquiry_id',
  'contract_version',
  'first_landing_page',
  'external_referrer',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gclid',
  'gbraid',
  'wbraid',
  'created_at_utc',
  'expires_at_utc',
  'payload_fingerprint',
] as const;
export type VisitRow = Record<(typeof VISIT_COLUMNS)[number], string | null> & {
  id: string;
  whatsapp_reference: string;
  website_inquiry_id: string;
  created_at_utc: string;
};

/** Dedicated SELECT-only development source, separate from the environment's business DataSource. */
@Injectable()
export class WebsiteVisitsReader implements OnModuleDestroy {
  private source?: DataSource;
  private connecting?: Promise<DataSource>;
  constructor(private readonly config: ConfigService) {}
  async connect(): Promise<QueryRunner> {
    const host = this.config.get<string>('LYNX_VISITS_DB_HOST');
    const password = this.config.get<string>('LYNX_VISITS_DB_PASSWORD');
    if (!host || !password) return this.unavailable();
    if (!this.source)
      this.source = new DataSource({
        type: 'postgres',
        host,
        port: Number(this.config.get('LYNX_VISITS_DB_PORT') ?? 5432),
        database:
          this.config.get<string>('LYNX_VISITS_DB_NAME') ?? 'travelops_dev',
        username:
          this.config.get<string>('LYNX_VISITS_DB_USER') ?? 'lynxtour_viewer',
        password,
        synchronize: false,
        extra: {
          max: 3,
          connectionTimeoutMillis: 5000,
          options:
            '-c default_transaction_read_only=on -c statement_timeout=5000',
        },
      });
    try {
      if (!this.source.isInitialized) {
        this.connecting ??= this.source.initialize().finally(() => {
          this.connecting = undefined;
        });
        await this.connecting;
      }
      const runner = this.source.createQueryRunner();
      try {
        await runner.connect();
        await runner.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        return runner;
      } catch (error) {
        await runner.release();
        throw error;
      }
    } catch {
      return this.unavailable();
    }
  }
  unavailable(): never {
    throw new BusinessException({
      code: 'INTERNAL_SERVER_ERROR',
      message: '访问记录暂时无法读取，请稍后重试',
      status: HttpStatus.SERVICE_UNAVAILABLE,
    });
  }
  async read<T>(work: (runner: QueryRunner) => Promise<T>): Promise<T> {
    const runner = await this.connect();
    try {
      return await work(runner);
    } catch (error) {
      if (error instanceof BusinessException) throw error;
      return this.unavailable();
    } finally {
      try {
        await runner.query('ROLLBACK');
      } finally {
        await runner.release();
      }
    }
  }
  async onModuleDestroy() {
    if (this.source?.isInitialized) await this.source.destroy();
  }
}
