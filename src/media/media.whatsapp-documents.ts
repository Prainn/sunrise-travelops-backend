import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  StreamableFile,
} from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { DataSource, EntityManager } from 'typeorm';
import { AuthenticatedUser } from '../auth/auth.types';
import { chatFail } from '../whatsapp/whatsapp.policy';
import { MediaConfig } from './media.config';
import { validateDocument } from './media.document-format';
import { MediaStorage } from './media.storage';

const DRAFT_MS = 24 * 60 * 60 * 1000;
const TRANSFER_TTL_SECONDS = 15 * 60;
const OSS_DOCUMENT_ORIGIN =
  'https://sunrise-travelops-media.oss-cn-hangzhou.aliyuncs.com';
type DocumentRow = {
  id: string;
  conversation_id: string;
  actor_identity_id: string;
  file_name: string;
  extension: 'pdf' | 'doc' | 'docx';
  mime_type: string;
  size_bytes: number;
  state: 'uploading' | 'ready' | 'deleting';
  uploaded_at: Date;
  claimed_at: Date | null;
};
@Injectable()
export class WhatsappDocuments implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private cleanup?: Promise<void>;
  private uploading = false;
  private readonly logger = new Logger(WhatsappDocuments.name);

  constructor(
    private readonly db: DataSource,
    private readonly config: MediaConfig,
    private readonly storage: MediaStorage,
  ) {}

  get enabled() {
    return this.config.documentsEnabled;
  }

  onModuleInit() {
    if (!this.enabled) return;
    this.timer = setInterval(() => {
      if (this.cleanup) return;
      this.cleanup = this.collectExpired()
        .catch(() =>
          this.logger.warn('WhatsApp document cleanup failed; will retry'),
        )
        .finally(() => {
          this.cleanup = undefined;
        });
    }, 60_000);
    this.timer.unref();
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.cleanup;
  }

  private async collectExpired() {
    for (let i = 0; i < 20; i++) {
      if (!(await this.cleanupExpiredDraft())) break;
    }
  }

  private assertEnabled() {
    if (!this.enabled) chatFail('CONFLICT', 'WhatsApp 文件存储尚未启用', 409);
    this.config.assertEnabled();
  }

  private key(row: Pick<DocumentRow, 'conversation_id' | 'id' | 'extension'>) {
    return `private/${this.config.environment}/whatsapp/${row.conversation_id}/${row.id}.${row.extension}`;
  }

  private present(row: DocumentRow) {
    return {
      id: row.id,
      fileName: row.file_name,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
    };
  }

  async upload(
    file: Express.Multer.File,
    user: AuthenticatedUser,
    conversationId: string,
  ) {
    this.assertEnabled();
    if (this.uploading)
      chatFail('CONFLICT', '正在上传其他文件，请稍后重试', 409);
    this.uploading = true;
    let row: DocumentRow | undefined;
    try {
      const fileInfo = await validateDocument(file.buffer, file.originalname);
      [row] = await this.db.query<DocumentRow[]>(
        `INSERT INTO whatsapp_documents(id,conversation_id,actor_identity_id,file_name,extension,mime_type,size_bytes,state)
         VALUES($1,$2,$3,$4,$5,$6,$7,'uploading') RETURNING *`,
        [
          randomUUID(),
          conversationId,
          user.identityId,
          fileInfo.fileName,
          fileInfo.extension,
          fileInfo.mimeType,
          file.buffer.length,
        ],
      );
      try {
        await this.storage.putDocument(this.key(row), file.buffer);
        const [[ready]] = await this.db.query<[DocumentRow[], number]>(
          `UPDATE whatsapp_documents SET state='ready',uploaded_at=now(),updated_at=now() WHERE id=$1 RETURNING *`,
          [row.id],
        );
        return {
          ...this.present(ready),
          expiresAt: new Date(ready.uploaded_at.getTime() + DRAFT_MS),
        };
      } catch {
        // A timed-out PUT may have reached OSS, so preserve the key for cleanup.
        await this.db.query(
          "UPDATE whatsapp_documents SET state='deleting',updated_at=now() WHERE id=$1 AND state='uploading'",
          [row.id],
        );
        chatFail('CONFLICT', '文件上传失败，请稍后重试', 409);
      }
    } finally {
      this.uploading = false;
    }
  }

  async claim(
    id: string,
    conversationId: string,
    user: AuthenticatedUser,
    manager: EntityManager,
    retry: boolean,
  ) {
    this.assertEnabled();
    const [row] = await manager.query<(DocumentRow & { expired: boolean })[]>(
      `SELECT *,uploaded_at<=now()-interval '24 hours' AS expired FROM whatsapp_documents
       WHERE id=$1 AND conversation_id=$2 FOR UPDATE`,
      [id, conversationId],
    );
    if (
      !row ||
      (!retry && row.actor_identity_id !== user.identityId) ||
      row.state === 'deleting' ||
      (!row.claimed_at && row.expired)
    )
      chatFail('NOT_FOUND', '文件不存在或已过期', 404);
    if (row.state !== 'ready' || (retry ? !row.claimed_at : !!row.claimed_at))
      chatFail('CONFLICT', '该文件尚不可发送或已发送', 409);
    if (!retry)
      await manager.query(
        'UPDATE whatsapp_documents SET claimed_at=now() WHERE id=$1',
        [row.id],
      );
    return this.present(row);
  }

  async signedLink(
    id: string,
    conversationId: string,
    purpose: 'download' | 'send',
  ) {
    this.assertEnabled();
    const [row] = await this.db.query<DocumentRow[]>(
      "SELECT * FROM whatsapp_documents WHERE id=$1 AND conversation_id=$2 AND state='ready' AND claimed_at IS NOT NULL",
      [id, conversationId],
    );
    if (!row) chatFail('NOT_FOUND', '文件不存在', 404);
    try {
      return await this.storage.signDocument(
        this.key(row),
        purpose,
        row.file_name,
      );
    } catch {
      chatFail('CONFLICT', '文件暂不可下载，请稍后重试', 409);
    }
  }

  private transferMac(messageId: string, file: string, expiry: string) {
    // Domain separation from bearer JWT signing, with binding to this deployment.
    const key = createHmac('sha256', this.config.documentTransferSecret)
      .update('sunrise-whatsapp-document-transfer-v1')
      .digest();
    return createHmac('sha256', key)
      .update([this.config.environment, messageId, file, expiry].join('\n'))
      .digest('base64url');
  }

  private async transferRecord(messageId: string) {
    const [row] = await this.db.query<DocumentRow[]>(
      `SELECT d.* FROM whatsapp_messages m JOIN whatsapp_documents d
        ON d.id=(m.attachment->>'documentId')::uuid AND d.conversation_id=m.conversation_id
        WHERE m.id=$1 AND m.direction='outbound' AND m.source='system'
          AND m.kind='document' AND m.status IN ('sending','accepted','sent','delivered','read','unknown')
          AND d.state='ready' AND d.claimed_at IS NOT NULL`,
      [messageId],
    );
    return row;
  }

  async createTransfer(messageId: string) {
    this.assertEnabled();
    const row = await this.transferRecord(messageId);
    if (!row) chatFail('NOT_FOUND', '文件不存在', 404);
    const file = 'file.' + row.extension;
    const expiry = (
      Math.floor(Date.now() / 1000) + TRANSFER_TTL_SECONDS
    ).toString(36);
    const token = expiry + '.' + this.transferMac(messageId, file, expiry);
    return {
      link: `${this.config.documentTransferOrigin}/api/whatsapp/document-transfer/${messageId}/${token}/${file}`,
      fileName: row.file_name,
    };
  }

  async readTransfer(
    messageId: string,
    token: string,
    file: string,
    headOnly: boolean,
  ) {
    const parts = /^([0-9a-z]{1,10})\.([a-zA-Z0-9_-]{43})$/.exec(token);
    const notFound = () => chatFail('NOT_FOUND', '文件链接无效或已过期', 404);
    if (!this.enabled || !parts || !/^file\.(pdf|docx?)$/.test(file))
      return notFound();
    const [, expiry, signature] = parts;
    const expiresAt = Number.parseInt(expiry, 36);
    const now = Math.floor(Date.now() / 1000);
    if (
      expiresAt <= now ||
      expiresAt > now + TRANSFER_TTL_SECONDS ||
      !timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(this.transferMac(messageId, file, expiry)),
      )
    )
      return notFound();
    const row = await this.transferRecord(messageId);
    if (!row || file !== 'file.' + row.extension) return notFound();
    const headers = { type: row.mime_type, length: row.size_bytes };
    if (headOnly) return new StreamableFile(Buffer.alloc(0), headers);

    try {
      const key = this.key(row);
      const { url } = await this.storage.signDocument(
        key,
        'send',
        row.file_name,
      );
      const signed = new URL(url);
      if (
        signed.origin !== OSS_DOCUMENT_ORIGIN ||
        signed.pathname !== '/' + key ||
        signed.username ||
        signed.password ||
        signed.hash ||
        !signed.search
      )
        throw new Error('DOCUMENT_OSS_URL_INVALID');
      const response = await fetch(signed, {
        redirect: 'error',
        headers: { 'accept-encoding': 'identity' },
        signal: AbortSignal.timeout(25_000),
      });
      if (
        response.status !== 200 ||
        Number(response.headers.get('content-length')) !== row.size_bytes ||
        !response.body ||
        ![null, 'identity'].includes(response.headers.get('content-encoding'))
      ) {
        await response.body?.cancel();
        throw new Error('DOCUMENT_OSS_READ_INVALID');
      }
      // Node fetch provides a native web stream; DOM and node:stream/web declare different overloads.
      return new StreamableFile(
        Readable.fromWeb(
          response.body as unknown as NodeReadableStream<Uint8Array>,
        ),
        headers,
      );
    } catch {
      chatFail('CONFLICT', '文档暂时无法读取', 409);
    }
  }

  async cleanupExpiredDraft() {
    const row = await this.db.transaction(async (manager) => {
      const [candidate] = await manager.query<DocumentRow[]>(
        `SELECT * FROM whatsapp_documents WHERE claimed_at IS NULL
          AND ((state IN ('uploading','ready') AND uploaded_at<=now()-interval '24 hours')
               OR (state='deleting' AND updated_at<=now()-interval '1 minute'))
          ORDER BY uploaded_at LIMIT 1 FOR UPDATE SKIP LOCKED`,
      );
      if (!candidate) return null;
      await manager.query(
        "UPDATE whatsapp_documents SET state='deleting',updated_at=now() WHERE id=$1",
        [candidate.id],
      );
      return candidate;
    });
    if (!row) return false;
    await this.storage.remove([this.key(row)]);
    await this.db.query(
      "DELETE FROM whatsapp_documents WHERE id=$1 AND state='deleting' AND claimed_at IS NULL",
      [row.id],
    );
    return true;
  }
}
