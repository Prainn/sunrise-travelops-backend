import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { notifyWhatsappChange } from '../whatsapp/whatsapp-changes';
import { ChatMessage } from '../whatsapp/whatsapp.types';
import { MediaConfig } from './media.config';
import {
  DOC_MIME,
  DocumentExtension,
  documentKey,
  inboundFileName,
} from './media.document-format';
import { downloadProviderDocument } from './media.provider-document';
import { MediaStorage } from './media.storage';

type ArchiveState =
  'pending' | 'processing' | 'available' | 'failed' | 'skipped';
type ArchiveJob = {
  id: string;
  conversation_id: string;
  environment: string;
  source_url: string | null;
  original_name: string | null;
  attempts: number;
  max_attempts: number;
};
type ArchiveView = {
  message_id: string;
  state: ArchiveState;
  error_code: string | null;
  extension: DocumentExtension;
  file_name: string;
  size_bytes: number;
};

// Raw provider metadata stays on the immutable message. No URL or provider-supplied
// document identity is allowed to become a usable workbench attachment.
function withoutLinks(value: unknown, sourceUrls: Set<unknown>): unknown {
  if (typeof value === 'string') {
    const clean = value.replace(/https?:\/\/[^\s<>"']+/gi, (url) =>
      sourceUrls.has(url) ||
      /\.aliyuncs\.com\b|[?&](?:x-oss-signature|signature|ossaccesskeyid)=/i.test(
        url,
      )
        ? ''
        : url,
    );
    return clean || (value === '' ? '' : undefined);
  }
  if (Array.isArray(value))
    return value
      .map((item) => withoutLinks(item, sourceUrls))
      .filter((v) => v !== undefined);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, item]: [string, unknown]) => {
        if (/(?:url|uri|href|link)$/i.test(key)) return [];
        const safe = withoutLinks(item, sourceUrls);
        return safe === undefined ? [] : [[key, safe]];
      }),
    );
  }
  return value;
}

@Injectable()
export class WhatsappDocumentArchive {
  constructor(
    private readonly db: DataSource,
    private readonly config: MediaConfig,
    private readonly storage: MediaStorage,
  ) {}

  async enqueue(messageId: string, manager: EntityManager) {
    if (this.config.documentsEnabled)
      await manager.query(
        'INSERT INTO whatsapp_document_archives(message_id,environment) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [messageId, this.config.environment],
      );
  }

  async attach(messages: ChatMessage[]) {
    const providerDocs = messages.filter(
      (m) => m.kind === 'document' && m.source !== 'system',
    );
    if (!providerDocs.length) return;
    const ids = providerDocs
      .filter((m) => m.direction === 'inbound')
      .map((m) => m.id);
    const env = this.config.configuredEnvironment;
    const rows =
      env && ids.length
        ? await this.db.query<ArchiveView[]>(
            'SELECT message_id,state,error_code,extension,file_name,size_bytes FROM whatsapp_document_archives WHERE environment=$1 AND message_id=ANY($2::uuid[])',
            [env, ids],
          )
        : [];
    const archives = new Map(rows.map((row) => [row.message_id, row]));
    for (const message of providerDocs) {
      const raw = message.attachment ?? {};
      const safe = withoutLinks(raw, new Set([raw.url, raw.fileUrl])) as Record<
        string,
        unknown
      >;
      for (const key of [
        'document',
        'documentId',
        'documentArchive',
        'media',
        'mediaAssetId',
      ])
        delete safe[key];
      message.attachment = safe;
      if (message.direction !== 'inbound') continue;
      const row = archives.get(message.id);
      safe.documentArchive = {
        state: row?.state ?? 'pending',
        ...(row?.state === 'failed' && row.error_code
          ? { errorCode: row.error_code }
          : {}),
      };
      if (row?.state === 'available')
        safe.document = {
          id: message.id,
          fileName: row.file_name,
          mimeType: DOC_MIME[row.extension],
          sizeBytes: row.size_bytes,
        };
    }
  }

  private async claim() {
    const environment = this.config.environment;
    return this.db.transaction(async (manager) => {
      // Live callbacks enqueue in their own transaction. Previously stored/imported rows get one attempt.
      await manager.query(
        `INSERT INTO whatsapp_document_archives (message_id,environment,max_attempts)
         SELECT m.id,$1,1 FROM whatsapp_messages m WHERE m.kind='document' AND m.direction='inbound'
           AND m.source='customer' AND NOT EXISTS (SELECT 1 FROM whatsapp_document_archives a WHERE a.environment=$1 AND a.message_id=m.id)
         ORDER BY m.seq DESC LIMIT 25 ON CONFLICT DO NOTHING`,
        [environment],
      );
      const [job] = await manager.query<ArchiveJob[]>(
        `SELECT m.id,m.conversation_id,a.environment,a.attempts,a.max_attempts,
          coalesce(nullif(m.attachment->>'url',''),nullif(m.attachment->>'fileUrl','')) source_url,
          m.attachment->>'fileName' original_name
         FROM whatsapp_document_archives a JOIN whatsapp_messages m ON m.id=a.message_id
         WHERE a.environment=$1 AND ((a.state='pending' AND a.available_at<=now())
           OR (a.state='processing' AND a.updated_at<now()-interval '5 minutes'))
         ORDER BY a.max_attempts DESC,a.available_at,m.seq DESC LIMIT 1 FOR UPDATE OF a SKIP LOCKED`,
        [environment],
      );
      if (!job) return;
      const exhausted = job.attempts >= job.max_attempts;
      if (exhausted) {
        await manager.query(
          `UPDATE whatsapp_document_archives SET state='failed',error_code='MEDIA_INTERRUPTED',updated_at=now()
          WHERE message_id=$1 AND environment=$2`,
          [job.id, environment],
        );
      } else {
        await manager.query(
          `UPDATE whatsapp_document_archives SET state='processing',attempts=attempts+1,updated_at=now()
          WHERE message_id=$1 AND environment=$2`,
          [job.id, environment],
        );
      }
      await notifyWhatsappChange(manager, {
        conversationId: job.conversation_id,
        reason: 'message',
      });
      return {
        ...job,
        exhausted,
        attempts: exhausted ? job.attempts : job.attempts + 1,
      };
    });
  }

  private async finish(
    job: ArchiveJob,
    state: ArchiveState,
    errorCode: string | null,
    document?: { bytes: Buffer; extension: DocumentExtension },
  ) {
    await this.db.transaction(async (manager) => {
      // Fence stale workers before an external PUT. A retry always addresses the same private key.
      const [owned] = await manager.query<{ message_id: string }[]>(
        `SELECT message_id FROM whatsapp_document_archives WHERE message_id=$1 AND environment=$2
         AND state='processing' AND attempts=$3 FOR UPDATE`,
        [job.id, job.environment, job.attempts],
      );
      if (!owned) return;
      const name = document
        ? inboundFileName(job.original_name, document.extension)
        : null;
      if (document)
        await this.storage.putDocument(
          documentKey(
            job.environment,
            job.conversation_id,
            job.id,
            document.extension,
          ),
          document.bytes,
        );
      await manager.query(
        `UPDATE whatsapp_document_archives SET state=$3,error_code=$4,file_name=$5,extension=$6,size_bytes=$7,
          updated_at=now(),available_at=now() + least(3600,power(2,attempts)::int*30)*interval '1 second'
         WHERE message_id=$1 AND environment=$2`,
        [
          job.id,
          job.environment,
          state,
          errorCode,
          name,
          document?.extension ?? null,
          document?.bytes.length ?? null,
        ],
      );
      await notifyWhatsappChange(manager, {
        conversationId: job.conversation_id,
        reason: 'message',
      });
    });
  }

  async processOne() {
    if (!this.config.documentsEnabled) return false;
    const job = await this.claim();
    if (!job) return false;
    if (job.exhausted) return true;
    try {
      const document = await downloadProviderDocument(job.source_url);
      if (document) await this.finish(job, 'available', null, document);
      else await this.finish(job, 'skipped', null);
    } catch (error) {
      const terminalCodes = [
        'MEDIA_SOURCE_EXPIRED',
        'MEDIA_URL_INVALID',
        'DOCUMENT_TOO_LARGE',
      ];
      const known = error instanceof Error ? error.message : '';
      const terminal = terminalCodes.includes(known);
      const code =
        terminal || known === 'MEDIA_DOWNLOAD_FAILED'
          ? known
          : 'MEDIA_PROCESS_FAILED';
      const retry = !terminal && job.attempts < job.max_attempts;
      await this.finish(job, retry ? 'pending' : 'failed', retry ? null : code);
    }
    return true;
  }
}
