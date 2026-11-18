import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebsiteVisitsDatabaseSource } from './website-visits-database.source';
import { WebsiteVisitsHttpSource } from './website-visits-http.source';
import { WebsiteVisitsQuery } from './website-visits.dto';

/** Raw source only. Confirmations and inquiry links always use the business DataSource. */
@Injectable()
export class WebsiteVisitsSource {
  constructor(
    private readonly config: ConfigService,
    private readonly database: WebsiteVisitsDatabaseSource,
    private readonly http: WebsiteVisitsHttpSource,
  ) {}
  private get source() {
    const mode =
      this.config.get<string>('LYNX_VISITS_SOURCE_MODE') ?? 'database';
    if (mode === 'database') return this.database;
    if (mode === 'http') return this.http;
    throw new Error('Invalid LYNX_VISITS_SOURCE_MODE');
  }
  list(query: WebsiteVisitsQuery) {
    return this.source.list(query);
  }
  row(id: string) {
    return this.source.row(id);
  }
  export(query: WebsiteVisitsQuery) {
    return this.source.export(query);
  }
}
