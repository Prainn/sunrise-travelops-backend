import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { Response } from 'express';
import { DataSource } from 'typeorm';
import { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';
import { AuthService } from '../auth/auth.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { BusinessException } from '../common/exceptions/business.exception';
import { chatPermission, chatFail } from './whatsapp.policy';
import { WhatsappService } from './whatsapp.service';
import {
  ChangeReason,
  parseWhatsappChange,
  WHATSAPP_CHANGES_CHANNEL,
} from './whatsapp-changes';

// pg is already a runtime dependency. Keep the small LISTEN API typed without adding dependencies.
interface Listener extends EventEmitter {
  connect(): Promise<void>;
  query(sql: string): Promise<unknown>;
  end(): Promise<void>;
}
const { Client } = createRequire(__filename)('pg') as {
  Client: new (options: Record<string, unknown>) => Listener;
};
interface Connection {
  id: string;
  user: AuthenticatedUser;
  fingerprint: string;
  response: Response;
  heartbeat: NodeJS.Timeout;
  expiry: NodeJS.Timeout;
  closed: boolean;
  checking: boolean;
}
const SUMMARY_REASONS = new Set<ChangeReason>([
  'message',
  'state',
  'assign',
  'read',
  'consultation',
]);
const MAX_PENDING = 1000;
const MAX_BUFFER_BYTES = 64 * 1024;

@Injectable()
export class WhatsappStreamService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsappStreamService.name);
  private readonly connections = new Set<Connection>();
  private listener?: Listener;
  private ready = false;
  private stopped = false;
  private retry?: NodeJS.Timeout;
  private listenerHeartbeat?: NodeJS.Timeout;
  private listenerChecking = false;
  private attempt = 0;
  private pending = new Map<string, Set<ChangeReason>>();
  private resync = false;
  private timer?: NodeJS.Timeout;
  private flushing = false;

  constructor(
    private readonly db: DataSource,
    private readonly auth: AuthService,
    private readonly whatsapp: WhatsappService,
  ) {}

  async onModuleInit() {
    await this.connect();
  }

  private async connect() {
    if (this.stopped) return;
    const options = this.db.options as PostgresConnectionOptions;
    const client = new Client({
      connectionString: options.url,
      host: options.host,
      port: options.port,
      user: options.username,
      password: options.password,
      database: options.database,
      ssl: options.ssl,
      application_name: 'whatsapp-sse-listener',
      connectionTimeoutMillis: 5000,
      query_timeout: 5000,
      keepAlive: true,
    });
    this.listener = client;
    client.on('error', () => this.disconnected(client));
    client.on('end', () => this.disconnected(client));
    client.on(
      'notification',
      (notification: { channel: string; payload?: string }) => {
        if (
          this.listener !== client ||
          !this.ready ||
          notification.channel !== WHATSAPP_CHANGES_CHANNEL
        )
          return;
        try {
          const change = parseWhatsappChange(notification.payload ?? '');
          if ('type' in change) this.resync = true;
          else {
            const reasons =
              this.pending.get(change.conversationId) ??
              new Set<ChangeReason>();
            reasons.add(change.reason);
            this.pending.set(change.conversationId, reasons);
          }
          if (this.pending.size > MAX_PENDING) {
            this.recover('notification_overflow');
            return;
          }
          this.schedule();
        } catch {
          this.recover('invalid_notification');
        }
      },
    );
    try {
      await client.connect();
      await client.query(`LISTEN ${WHATSAPP_CHANGES_CHANNEL}`);
      if (this.stopped || this.listener !== client) {
        await client.end().catch(() => undefined);
        return;
      }
      this.ready = true;
      this.attempt = 0;
      this.resync = true;
      this.schedule();
      this.listenerHeartbeat = setInterval(() => {
        if (this.listenerChecking) return;
        this.listenerChecking = true;
        void client
          .query('SELECT 1')
          .catch(() => this.disconnected(client))
          .finally(() => {
            this.listenerChecking = false;
          });
      }, 20000);
    } catch {
      this.disconnected(client);
    }
  }

  private disconnected(client: Listener) {
    if (this.listener !== client) return;
    this.listener = undefined;
    this.ready = false;
    clearInterval(this.listenerHeartbeat);
    this.listenerHeartbeat = undefined;
    void client.end().catch(() => undefined);
    this.recover('listener_unavailable');
    if (!this.stopped) {
      const delay =
        Math.min(30000, 1000 * 2 ** Math.min(this.attempt++, 5)) +
        Math.floor(Math.random() * 500);
      this.retry = setTimeout(() => {
        void this.connect();
      }, delay);
    }
  }

  private fingerprint(user: AuthenticatedUser) {
    return JSON.stringify([
      user.id,
      user.username,
      user.identityId,
      user.scope,
      user.deptId,
      user.sessionId,
      user.sessionVersion,
      [...user.roles].sort(),
      [...user.permissions].sort(),
      [...user.menuKeys].sort(),
    ]);
  }

  async open(user: AuthenticatedUser, response: Response) {
    chatPermission(user);
    if (
      !Number.isFinite(user.accessExpiresAt) ||
      user.accessExpiresAt! <= Date.now()
    )
      chatFail('AUTH_TOKEN_EXPIRED', '访问令牌已过期', 401);
    const current = await this.currentUser(user);
    if (this.fingerprint(current) !== this.fingerprint(user))
      chatFail('AUTH_FORBIDDEN', '当前身份权限已变化，请刷新', 403);
    if (!this.ready || this.stopped)
      chatFail('INTERNAL_SERVER_ERROR', '实时通知暂不可用，请稍后重连', 503);
    if (response.destroyed) return;
    const sameUser = [...this.connections].filter(
      (connection) => connection.user.id === user.id,
    );
    if (sameUser.length >= 10)
      this.close(sameUser[0], 'limit', 'connection.limited');
    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();
    const connection: Connection = {
      id: randomUUID(),
      user,
      fingerprint: this.fingerprint(user),
      response,
      closed: false,
      checking: false,
      heartbeat: setInterval(() => {
        void this.heartbeat(connection);
      }, 20000),
      expiry: setTimeout(
        () => this.close(connection, 'expired', 'auth.expired'),
        Math.max(0, user.accessExpiresAt! - Date.now() - 10000),
      ),
    };
    this.connections.add(connection);
    response.once('close', () => this.close(connection, 'client_closed'));
    response.once('error', () => this.close(connection, 'transport_error'));
    this.log(connection, 'opened');
    this.send(connection, 'ready', { serverTime: new Date().toISOString() });
  }

  private async currentUser(user: AuthenticatedUser) {
    const current = await this.auth.getCurrentUser(
      user.id,
      user.identityId,
      user.scope,
      user.menuKeys,
      user.sessionId,
      user.sessionVersion,
    );
    chatPermission(current);
    return current;
  }

  private async validate(connection: Connection) {
    if (connection.closed) return null;
    if (connection.user.accessExpiresAt! <= Date.now() + 10000) {
      this.close(connection, 'expired', 'auth.expired');
      return null;
    }
    try {
      const current = await this.currentUser(connection.user);
      if (this.fingerprint(current) !== connection.fingerprint) {
        this.close(connection, 'access_changed', 'access.changed');
        return null;
      }
      return connection.closed ? null : current;
    } catch (error) {
      if (
        error instanceof BusinessException &&
        [401, 403].includes(error.getStatus())
      )
        this.close(connection, 'access_changed', 'access.changed');
      else this.close(connection, 'validation_unavailable', 'resync');
      return null;
    }
  }

  private async heartbeat(connection: Connection) {
    if (connection.checking || connection.closed) return;
    connection.checking = true;
    try {
      if (await this.validate(connection)) this.write(connection, ': ping\n\n');
    } finally {
      connection.checking = false;
    }
  }

  private schedule() {
    if (this.timer || this.flushing || this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, 400);
  }

  private async flush() {
    this.flushing = true;
    const pending = this.pending;
    const resync = this.resync;
    this.pending = new Map();
    this.resync = false;
    const access = [...pending.values()].some(
      (reasons) => reasons.has('assign') || reasons.has('consultation'),
    );
    try {
      // Bounded by connection count; scope SQL batches all IDs for each current identity.
      await Promise.all(
        [...this.connections].map(async (connection) => {
          const user = await this.validate(connection);
          if (!user) return;
          if (resync) {
            this.send(connection, 'resync', {});
            return;
          }
          const visible = await this.whatsapp.visibleConversationIds(
            [...pending.keys()],
            user,
          );
          if (connection.closed) return;
          if (access) this.send(connection, 'access.changed', {});
          let summary = access;
          for (const id of visible) {
            const reasons = pending.get(id)!;
            this.send(connection, 'conversation.changed', {
              conversationId: id,
              reasons: [...reasons].sort(),
            });
            if ([...reasons].some((reason) => SUMMARY_REASONS.has(reason)))
              summary = true;
          }
          if (summary) this.send(connection, 'summary.changed', {});
        }),
      );
    } catch {
      this.recover('dispatch_failed');
    } finally {
      this.flushing = false;
      if (this.pending.size || this.resync) this.schedule();
    }
  }

  private write(connection: Connection, frame: string) {
    const response = connection.response;
    if (connection.closed) return;
    // Do not retain frames with potentially stale conversation IDs while a socket is blocked.
    if (
      response.destroyed ||
      response.writableEnded ||
      response.writableNeedDrain ||
      response.writableLength + Buffer.byteLength(frame) > MAX_BUFFER_BYTES
    ) {
      this.close(connection, 'slow_client');
      return;
    }
    try {
      if (!response.write(frame)) this.close(connection, 'slow_client');
    } catch {
      this.close(connection, 'transport_error');
    }
  }
  private send(connection: Connection, event: string, data: unknown) {
    this.write(
      connection,
      `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
    );
  }
  private close(connection: Connection, reason: string, event?: string) {
    if (connection.closed) return;
    connection.closed = true;
    clearInterval(connection.heartbeat);
    clearTimeout(connection.expiry);
    this.connections.delete(connection);
    const response = connection.response;
    if (!response.destroyed && !response.writableEnded) {
      if (response.writableNeedDrain || reason === 'slow_client')
        response.destroy();
      else response.end(event ? `event: ${event}\ndata: {}\n\n` : undefined);
    }
    this.log(connection, reason);
  }
  private log(connection: Connection, reason: string) {
    this.logger.log({
      userId: connection.user.id,
      connectionId: connection.id,
      connections: this.connections.size,
      reason,
      msg: 'WhatsApp stream lifecycle',
    });
  }
  private recover(reason: string) {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending.clear();
    this.resync = false;
    for (const connection of this.connections)
      this.close(connection, reason, 'resync');
  }
  async onModuleDestroy() {
    this.stopped = true;
    this.ready = false;
    clearTimeout(this.retry);
    clearInterval(this.listenerHeartbeat);
    this.recover('shutdown');
    const listener = this.listener;
    this.listener = undefined;
    await listener?.end().catch(() => undefined);
  }
}
