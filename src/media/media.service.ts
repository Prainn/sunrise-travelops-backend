import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { AuthenticatedUser } from '../auth/auth.types';
import { ChatMessage } from '../whatsapp/whatsapp.types';
import { chatFail } from '../whatsapp/whatsapp.policy';
import { notifyWhatsappChange } from '../whatsapp/whatsapp-changes';
import { MediaConfig } from './media.config';
import { MediaStorage } from './media.storage';
import { downloadProviderMedia, prepareImage } from './media.images';
import { MediaQuery, UpdateMediaDto } from './media.dto';

export interface MediaResource {
  id: string;
  environment: 'dev' | 'prod';
  name: string;
  remark: string;
  kind: 'image' | 'sticker';
  source: string;
  source_url: string | null;
  message_id: string | null;
  conversation_id: string | null;
  actor_id: string | null;
  state: string;
  object_key: string | null;
  thumbnail_key: string | null;
  send_key: string | null;
  mime_type: string | null;
  size: number | null;
  width: number | null;
  height: number | null;
  attempts: number;
  error_code: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  references?: number;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class MediaService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private current?: Promise<void>;
  private stopped = false;
  private processing = 0;
  private nextDraftCleanupAt = 0;
  private readonly logger = new Logger(MediaService.name);
  constructor(
    private readonly db: DataSource,
    readonly config: MediaConfig,
    private readonly storage: MediaStorage,
  ) {}
  onModuleInit() {
    if (!this.config.enabled) return;
    this.config.assertEnabled();
    const tick = () => {
      this.current = this.processOne()
        .catch(() => {
          this.logger.warn('Media worker failed (details suppressed)');
        })
        .then(async () => {
          if (this.stopped || Date.now() < this.nextDraftCleanupAt) return;
          this.nextDraftCleanupAt = Date.now() + 60000;
          try {
            if (await this.cleanupExpiredDraft()) this.nextDraftCleanupAt = 0;
          } catch {
            this.logger.warn('WhatsApp draft cleanup failed; will retry');
          }
        })
        .finally(() => {
          if (!this.stopped) this.timer = setTimeout(tick, 3000);
        });
    };
    this.timer = setTimeout(tick, 1000);
  }
  async onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.current;
  }
  admin(user: AuthenticatedUser, action: string) {
    if (
      user.scope !== 'headquarters' ||
      user.roles.includes('BOSS') ||
      !user.roles.some((r) => ['ROOT', 'ADMIN'].includes(r)) ||
      !user.permissions.includes('sys:oss:' + action)
    )
      chatFail('AUTH_FORBIDDEN', '无OSS管理权限', 403);
    this.config.assertEnabled();
  }
  present(r: MediaResource) {
    return {
      id: r.id,
      environment: r.environment,
      name: r.name,
      remark: r.remark,
      kind: r.kind,
      source: r.source,
      state: r.state,
      mimeType: r.mime_type,
      size: r.size,
      width: r.width,
      height: r.height,
      version: r.version,
      errorCode: r.error_code,
      originalUrl: r.state === 'ready' ? this.config.url(r.object_key) : null,
      thumbnailUrl:
        r.state === 'ready'
          ? this.config.url(
              r.kind === 'sticker' ? r.object_key : r.thumbnail_key,
            )
          : null,
      previewable: r.state === 'ready' && !!this.config.publicOrigin,
      clickable: r.kind === 'image',
      objectKey: r.object_key,
      referenceCount: r.references ?? 0,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }
  async get(
    id: string,
    manager = this.db.manager,
    lock = false,
  ): Promise<MediaResource> {
    const [r] = await manager.query<MediaResource[]>(
      `SELECT * FROM oss_resources WHERE id=$1 AND environment=$2 ${lock ? 'FOR UPDATE' : ''}`,
      [id, this.config.environment],
    );
    if (!r) chatFail('NOT_FOUND', '资源不存在', 404);
    return r;
  }
  async list(query: MediaQuery, user: AuthenticatedUser) {
    this.admin(user, 'list');
    const args: unknown[] = [this.config.environment];
    let where = 'environment=$1';
    if (query.kind) where += ` AND kind=$${args.push(query.kind)}`;
    if (query.state) where += ` AND state=$${args.push(query.state)}`;
    if (query.keyword)
      where += ` AND position(lower($${args.push(query.keyword)}) in lower(name||' '||remark))>0`;
    const [count] = await this.db.query<{ total: number }[]>(
      `SELECT count(*)::int total FROM oss_resources WHERE ${where}`,
      args,
    );
    const rows = await this.db.query<MediaResource[]>(
      `SELECT r.*,(SELECT count(*)::int FROM whatsapp_messages m WHERE m.attachment->>'mediaAssetId'=r.id::text OR m.id=r.message_id) AS "references" FROM oss_resources r WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
      [...args, query.pageSize, (query.page - 1) * query.pageSize],
    );
    return {
      list: rows.map((r) => this.present(r)),
      total: count.total,
      page: query.page,
      pageSize: query.pageSize,
      environment: this.config.environment,
    };
  }
  async detail(id: string, user: AuthenticatedUser) {
    this.admin(user, 'list');
    const r = await this.get(id);
    r.references = await this.references(r, this.db.manager);
    return this.present(r);
  }
  async update(id: string, input: UpdateMediaDto, user: AuthenticatedUser) {
    this.admin(user, 'update');
    if (!input.name.trim())
      chatFail('VALIDATION_ERROR', '文件名称不能为空', 400);
    const [rows] = await this.db.query<[MediaResource[], number]>(
      `UPDATE oss_resources SET name=$3,remark=$4,version=version+1,updated_at=now() WHERE id=$1 AND environment=$2 AND version=$5 AND state<>'deleting' RETURNING *`,
      [
        id,
        this.config.environment,
        input.name.trim(),
        input.remark,
        input.version,
      ],
    );
    if (!rows.length) {
      await this.get(id);
      chatFail('CONFLICT', '资源已更新，请刷新', 409);
    }
    return this.present(rows[0]);
  }
  private async references(r: MediaResource, m: EntityManager) {
    const [v] = await m.query<{ n: number }[]>(
      `SELECT count(*)::int n FROM whatsapp_messages WHERE attachment->>'mediaAssetId'=$1 OR id=$2`,
      [r.id, r.message_id],
    );
    return v.n;
  }
  async remove(id: string, version: number, user: AuthenticatedUser) {
    this.admin(user, 'delete');
    const resource = await this.db.transaction(async (m) => {
      const r = await this.get(id, m, true);
      if (r.version !== version)
        chatFail('CONFLICT', '资源已更新，请刷新', 409);
      if (r.state === 'processing') chatFail('CONFLICT', '资源正在处理', 409);
      if (await this.references(r, m))
        chatFail('CONFLICT', '资源已被消息引用，不能删除', 409);
      await m.query(
        "UPDATE oss_resources SET state='deleting',updated_at=now() WHERE id=$1",
        [id],
      );
      return r;
    });
    await this.deleteResource(resource);
    return { id, deleted: true };
  }
  private async deleteResource(resource: MediaResource) {
    const keys = [
      resource.object_key,
      resource.thumbnail_key,
      resource.send_key,
    ].filter((k): k is string => !!k);
    if (keys.length) await this.storage.remove([...new Set(keys)]);
    await this.db.query(
      "DELETE FROM oss_resources WHERE id=$1 AND environment=$2 AND state='deleting'",
      [resource.id, this.config.environment],
    );
  }
  async cleanupExpiredDraft(): Promise<boolean> {
    if (!this.config.enabled) return false;
    const resource = await this.db.transaction(async (m) => {
      const [r] = await m.query<MediaResource[]>(
        `SELECT r.* FROM oss_resources r
        WHERE r.environment=$1 AND r.source='upload' AND r.kind='image'
          AND r.message_id IS NULL AND r.conversation_id IS NOT NULL
          AND r.state IN ('ready','failed','deleting') AND r.available_at<=now()
          AND r.created_at<now()-interval '24 hours'
          AND NOT EXISTS (SELECT 1 FROM whatsapp_messages m WHERE m.attachment->>'mediaAssetId'=r.id::text)
        ORDER BY r.created_at,r.id LIMIT 1 FOR UPDATE OF r SKIP LOCKED`,
        [this.config.environment],
      );
      // Sending takes the same resource lock. Recheck using a fresh snapshot
      // before claiming deletion in case it committed as selection began.
      if (!r || (await this.references(r, m))) return null;
      await m.query(
        `UPDATE oss_resources SET state='deleting',updated_at=now(),
          available_at=now()+interval '5 minutes' WHERE id=$1`,
        [r.id],
      );
      return r;
    });
    if (!resource) return false;
    // If OSS is unavailable or the worker stops here, the claim can be retried.
    await this.deleteResource(resource);
    return true;
  }
  async upload(
    bytes: Buffer,
    name: string,
    user: AuthenticatedUser,
    conversationId?: string,
  ) {
    this.config.assertEnabled();
    if (this.processing >= 1)
      chatFail('CONFLICT', '图片正在处理，请稍后重试', 409);
    this.processing++;
    let resource: MediaResource | undefined;
    try {
      const prepared = await prepareImage(bytes, 'image');
      const [row] = await this.db.query<MediaResource[]>(
        `INSERT INTO oss_resources(id,environment,name,kind,source,actor_id,conversation_id,state) VALUES($1,$2,$3,'image',$4,$5,$6,'processing') RETURNING *`,
        [
          randomUUID(),
          this.config.environment,
          name.slice(0, 200) || 'image',
          conversationId ? 'upload' : 'management',
          user.id,
          conversationId ?? null,
        ],
      );
      resource = row;
      await this.store(row, prepared);
      return this.present(await this.get(row.id));
    } catch (error) {
      if (resource) await this.fail(resource.id, 'MEDIA_UPLOAD_FAILED', false);
      if (
        error instanceof Error &&
        ['MEDIA_TOO_LARGE', 'MEDIA_TYPE_INVALID'].includes(error.message)
      )
        chatFail(
          'VALIDATION_ERROR',
          error.message === 'MEDIA_TOO_LARGE'
            ? '单张图片不能超过5MB'
            : '仅支持有效的JPEG、PNG、WebP、GIF图片',
          400,
        );
      chatFail('CONFLICT', '图片处理或上传失败，请稍后重试', 409);
    } finally {
      this.processing--;
    }
  }
  private async store(
    r: MediaResource,
    p: Awaited<ReturnType<typeof prepareImage>>,
  ) {
    const prefix = `${r.environment}/whatsapp/${r.id}`;
    const original = `${prefix}/original.${p.ext}`,
      thumb = p.thumbnail ? `${prefix}/thumbnail.webp` : null,
      send = p.send ? `${prefix}/send.jpg` : original;
    await this.db.query(
      'UPDATE oss_resources SET object_key=$2,thumbnail_key=$3,send_key=$4 WHERE id=$1',
      [r.id, original, thumb, send],
    );
    await this.storage.put(original, p.original, p.mime);
    if (thumb && p.thumbnail)
      await this.storage.put(thumb, p.thumbnail, 'image/webp');
    if (p.send) await this.storage.put(send, p.send, 'image/jpeg');
    await this.db.transaction(async (m) => {
      await m.query(
        `UPDATE oss_resources SET state='ready',mime_type=$2,size=$3,width=$4,height=$5,error_code=NULL,source_url=NULL,version=version+1,updated_at=now() WHERE id=$1`,
        [r.id, p.mime, p.original.length, p.width, p.height],
      );
      if (r.conversation_id)
        await notifyWhatsappChange(m, {
          conversationId: r.conversation_id,
          reason: 'message',
        });
    });
  }
  private async fail(id: string, code: string, retry: boolean) {
    await this.db.transaction(async (m) => {
      const [[r]] = await m.query<[MediaResource[], number]>(
        `UPDATE oss_resources SET state=CASE WHEN $3 AND attempts<5 THEN 'pending' ELSE 'failed' END,error_code=$2,available_at=now()+least(3600,power(2,attempts)::int*30)*interval '1 second',updated_at=now() WHERE id=$1 RETURNING *`,
        [id, code, retry],
      );
      if (r?.conversation_id)
        await notifyWhatsappChange(m, {
          conversationId: r.conversation_id,
          reason: 'message',
        });
    });
  }
  async processOne(): Promise<boolean> {
    if (!this.config.enabled || this.processing >= 1) return false;
    this.processing++;
    try {
      // Durable discovery covers new callbacks and older media; original events/order are untouched.
      await this.db.query(
        `INSERT INTO oss_resources(environment,name,kind,source,source_url,message_id,conversation_id)
        SELECT $1,left(coalesce(nullif(m.attachment->>'fileName',''),m.kind),200),m.kind,'whatsapp',coalesce(nullif(m.attachment->>'url',''),nullif(m.attachment->>'fileUrl','')),m.id,m.conversation_id
        FROM whatsapp_messages m WHERE m.kind IN ('image','sticker') AND (m.attachment->>'mediaAssetId') IS NULL AND NOT EXISTS(SELECT 1 FROM oss_resources r WHERE r.message_id=m.id)
        ORDER BY m.seq DESC LIMIT 25 ON CONFLICT(message_id) DO NOTHING`,
        [this.config.environment],
      );
      const resource = await this.db.transaction(async (m) => {
        await m.query(
          `UPDATE oss_resources SET state=CASE WHEN source='whatsapp' AND attempts<5 THEN 'pending' ELSE 'failed' END,error_code='MEDIA_INTERRUPTED',updated_at=now() WHERE environment=$1 AND state='processing' AND updated_at<now()-interval '5 minutes'`,
          [this.config.environment],
        );
        const [r] = await m.query<MediaResource[]>(
          `SELECT * FROM oss_resources WHERE environment=$1 AND state='pending' AND available_at<=now() ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`,
          [this.config.environment],
        );
        if (!r) return null;
        await m.query(
          "UPDATE oss_resources SET state='processing',attempts=attempts+1,updated_at=now() WHERE id=$1",
          [r.id],
        );
        return r;
      });
      if (!resource) return false;
      try {
        const bytes = await downloadProviderMedia(resource.source_url);
        await this.store(resource, await prepareImage(bytes, resource.kind));
      } catch (error) {
        const code =
          error instanceof Error && /^MEDIA_[A-Z_]+$/.test(error.message)
            ? error.message
            : 'MEDIA_PROCESS_FAILED';
        await this.fail(
          resource.id,
          code,
          ![
            'MEDIA_SOURCE_EXPIRED',
            'MEDIA_URL_INVALID',
            'MEDIA_TYPE_INVALID',
            'MEDIA_TOO_LARGE',
          ].includes(code),
        );
      }
      return true;
    } finally {
      this.processing--;
    }
  }
  async retry(id: string, version: number, user: AuthenticatedUser) {
    this.admin(user, 'update');
    const r = await this.get(id);
    if (
      r.version !== version ||
      r.state !== 'failed' ||
      r.source !== 'whatsapp'
    )
      chatFail('CONFLICT', '仅失败的接收附件可重试，请刷新', 409);
    const [[updated]] = await this.db.query<[MediaResource[], number]>(
      "UPDATE oss_resources SET state='pending',attempts=0,error_code=NULL,available_at=now(),version=version+1,updated_at=now() WHERE id=$1 AND version=$2 AND state='failed' RETURNING *",
      [id, version],
    );
    if (!updated) chatFail('CONFLICT', '资源已更新，请刷新', 409);
    return this.present(updated);
  }
  async attach(messages: ChatMessage[]) {
    if (!this.config.enabled || !messages.length) return;
    const ids = messages.map((m) => m.id),
      assets = messages
        .map((m) => m.attachment?.mediaAssetId)
        .filter(
          (id): id is string => typeof id === 'string' && UUID_PATTERN.test(id),
        );
    const rows = await this.db.query<MediaResource[]>(
      'SELECT * FROM oss_resources WHERE environment=$1 AND (message_id=ANY($2::uuid[]) OR id=ANY($3::uuid[]))',
      [this.config.environment, ids, assets],
    );
    for (const m of messages) {
      const r = rows.find(
        (r) => r.message_id === m.id || r.id === m.attachment?.mediaAssetId,
      );
      if (r)
        m.attachment = {
          ...m.attachment,
          mediaAssetId: r.id,
          media: this.present(r),
        };
    }
  }
  async attachReplyThumbnails(
    messages: ChatMessage[],
    manager = this.db.manager,
  ) {
    if (!this.config.enabled) return;
    const replies = messages.flatMap((message) => {
      const reply = message.attachment?.replyTo;
      if (
        !reply ||
        typeof reply !== 'object' ||
        !('id' in reply) ||
        typeof reply.id !== 'string' ||
        !UUID_PATTERN.test(reply.id) ||
        !('kind' in reply) ||
        reply.kind !== 'image'
      )
        return [];
      return [{ message, reply, id: reply.id }];
    });
    if (!replies.length) return;
    const rows = await manager.query<
      { id: string; conversationId: string; thumbnailKey: string | null }[]
    >(
      `SELECT DISTINCT ON (t.id) t.id,t.conversation_id AS "conversationId",r.thumbnail_key AS "thumbnailKey"
       FROM whatsapp_messages t JOIN oss_resources r
         ON (r.message_id=t.id OR r.id::text=t.attachment->>'mediaAssetId')
       WHERE t.id=ANY($1::uuid[]) AND t.conversation_id=ANY($2::uuid[])
         AND t.kind='image' AND r.kind='image' AND r.environment=$3 AND r.state='ready'
       ORDER BY t.id,(r.message_id=t.id) DESC NULLS LAST,r.id`,
      [
        [...new Set(replies.map(({ id }) => id))],
        [...new Set(replies.map(({ message }) => message.conversationId))],
        this.config.environment,
      ],
    );
    const targets = new Map(rows.map((row) => [row.id, row]));
    for (const { message, reply, id } of replies) {
      const target = targets.get(id);
      message.attachment = {
        ...message.attachment,
        replyTo: {
          ...reply,
          thumbnailUrl:
            target?.conversationId === message.conversationId
              ? this.config.url(target.thumbnailKey)
              : null,
        },
      };
    }
  }
  async sendingAsset(
    id: string,
    conversationId: string,
    user: AuthenticatedUser,
    manager: EntityManager,
    retry = false,
  ) {
    this.config.assertEnabled();
    const r = await this.get(id, manager, true);
    if (
      r.conversation_id !== conversationId ||
      (!retry && r.actor_id !== user.id) ||
      r.source !== 'upload'
    )
      chatFail('NOT_FOUND', '图片不存在', 404);
    if (
      r.state !== 'ready' ||
      r.kind !== 'image' ||
      !r.send_key ||
      !this.config.url(r.send_key)
    )
      chatFail('CONFLICT', '图片尚未准备好或CDN未配置', 409);
    return {
      mediaAssetId: r.id,
      media: this.present(r),
      mediaLink: this.config.url(r.send_key),
    };
  }
}
