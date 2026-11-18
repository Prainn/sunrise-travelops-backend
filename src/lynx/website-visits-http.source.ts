import {
  HttpStatus,
  Injectable,
  OnModuleDestroy,
  StreamableFile,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Agent, request } from 'node:https';
import { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
import { isUUID } from 'class-validator';
import { BusinessException } from '../common/exceptions/business.exception';
import { VisitRow, VISIT_COLUMNS } from './website-visits-reader';
import {
  VisitPage,
  validateVisitRange,
} from './website-visits-database.source';
import { WebsiteVisitsQuery } from './website-visits.dto';
import { visitsApiOrigin, visitsApiToken } from './website-visits-api.config';

const PREFIX = '/api/internal/website-visits';
function unavailable(): never {
  throw new BusinessException({
    code: 'INTERNAL_SERVER_ERROR',
    message: '访问记录暂时无法读取，请稍后重试',
    status: HttpStatus.SERVICE_UNAVAILABLE,
  });
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function row(value: unknown): VisitRow {
  if (!object(value) || !isUUID(String(value.id))) return unavailable();
  const result: Record<string, string | null> = {};
  for (const column of VISIT_COLUMNS) {
    const field = value[column];
    if (typeof field !== 'string' && field !== null) return unavailable();
    result[column] = field;
  }
  for (const key of [
    'whatsapp_reference',
    'website_inquiry_id',
    'contract_version',
    'created_at_utc',
    'expires_at_utc',
    'payload_fingerprint',
  ])
    if (typeof result[key] !== 'string') return unavailable();
  if (
    !Number.isFinite(Date.parse(result.created_at_utc!)) ||
    !Number.isFinite(Date.parse(result.expires_at_utc!))
  )
    return unavailable();
  // Never carry remote confirmed/converted/inquiry fields into this environment.
  return result as VisitRow;
}

@Injectable()
export class WebsiteVisitsHttpSource implements OnModuleDestroy {
  private readonly agent = new Agent({ keepAlive: true, maxSockets: 3 });
  constructor(private readonly config: ConfigService) {}

  private async open(
    path: string,
    exportFile = false,
  ): Promise<IncomingMessage> {
    try {
      const url = visitsApiOrigin(this.config.get('LYNX_VISITS_API_URL'));
      const token = this.config.get<string>('LYNX_VISITS_API_CLIENT_TOKEN');
      const address = this.config.get<string>('LYNX_VISITS_API_CONNECT_IP');
      if (!visitsApiToken(token) || (address && !isIP(address)))
        return unavailable();
      return await new Promise<IncomingMessage>((resolve, reject) => {
        const req = request({
          protocol: 'https:',
          hostname: address || url.hostname,
          port: url.port || 443,
          servername: url.hostname,
          path: PREFIX + path,
          method: 'GET',
          agent: this.agent,
          rejectUnauthorized: true,
          headers: {
            host: url.host,
            authorization: `Bearer ${token}`,
            accept: exportFile ? 'text/csv' : 'application/json',
          },
        });
        const deadline = setTimeout(
          () => req.destroy(new Error('Visits source timeout')),
          exportFile ? 30000 : 5000,
        );
        deadline.unref();
        req.once('error', (error) => {
          clearTimeout(deadline);
          reject(error);
        });
        req.once('response', (response) => {
          response.once('close', () => clearTimeout(deadline));
          response.once('error', () => undefined);
          resolve(response);
        });
        req.end();
      });
    } catch {
      return unavailable();
    }
  }

  private query(query: WebsiteVisitsQuery): string {
    const params = new URLSearchParams();
    for (const key of ['page', 'pageSize', 'start', 'end', 'keyword'] as const)
      if (query[key] !== undefined) params.set(key, String(query[key]));
    return '?' + params.toString();
  }

  private async json(path: string, detail = false): Promise<unknown> {
    const response = await this.open(path);
    if (detail && response.statusCode === 404) {
      response.destroy();
      throw new BusinessException({
        code: 'NOT_FOUND',
        message: '访问记录不存在',
        status: HttpStatus.NOT_FOUND,
      });
    }
    try {
      if (
        response.statusCode !== 200 ||
        !response.headers['content-type']?.includes('application/json')
      )
        return unavailable();
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of response) {
        const bytes = Buffer.from(chunk as Uint8Array);
        size += bytes.length;
        if (size > 4 * 1024 * 1024) return unavailable();
        chunks.push(bytes);
      }
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!object(body) || body.code !== 'SUCCESS') return unavailable();
      return body.data;
    } catch {
      return unavailable();
    } finally {
      response.destroy();
    }
  }

  async list(query: WebsiteVisitsQuery): Promise<VisitPage> {
    validateVisitRange(query);
    const result = await this.json(this.query(query));
    if (
      !object(result) ||
      !Array.isArray(result.list) ||
      !Number.isSafeInteger(result.total) ||
      Number(result.total) < 0 ||
      result.page !== query.page ||
      result.pageSize !== query.pageSize ||
      result.list.length > query.pageSize ||
      result.list.length > Number(result.total)
    )
      return unavailable();
    return {
      list: result.list.map(row),
      total: Number(result.total),
      page: query.page,
      pageSize: query.pageSize,
    };
  }
  async row(id: string): Promise<VisitRow> {
    const result = row(await this.json('/' + encodeURIComponent(id), true));
    if (result.id.toLowerCase() !== id.toLowerCase()) return unavailable();
    return result;
  }
  async export(query: WebsiteVisitsQuery): Promise<StreamableFile> {
    validateVisitRange(query, true);
    const response = await this.open('/export' + this.query(query), true);
    if (
      response.statusCode !== 200 ||
      !response.headers['content-type']?.startsWith('text/csv')
    ) {
      response.destroy();
      return unavailable();
    }
    return new StreamableFile(response, {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="lynxtour-visits_${query.start}_${query.end}.csv"`,
    });
  }
  onModuleDestroy() {
    this.agent.destroy();
  }
}
