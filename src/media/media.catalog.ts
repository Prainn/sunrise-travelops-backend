import type { DocumentExtension } from './media.document-format';

export interface MediaCatalogRow {
  id: string;
  environment: 'dev' | 'prod';
  name: string;
  remark: string;
  kind: 'image' | 'sticker' | 'pdf' | 'word';
  source: string;
  state: string;
  mime_type: string | null;
  size: number | null;
  width: number | null;
  height: number | null;
  version: number | null;
  error_code: string | null;
  object_key: string | null;
  thumbnail_key: string | null;
  created_at: Date;
  updated_at: Date;
  references?: number;
  conversation_id: string | null;
  message_id: string | null;
  extension?: DocumentExtension | null;
}

// Outbound retries can reference the same stored file. Keep one entry and one
// real message through which the workbench can authorize a preview or download.
export const MEDIA_CATALOG = `
  WITH chat_documents AS (
    SELECT d.id, d.conversation_id, (array_agg(m.id ORDER BY m.seq DESC))[1] AS message_id,
           d.file_name, d.extension, d.size_bytes, 'upload' AS source, count(*)::int AS ref_count,
           d.uploaded_at AS created_at, d.updated_at
    FROM whatsapp_documents d JOIN whatsapp_messages m
      ON m.conversation_id=d.conversation_id AND m.attachment->>'documentId'=d.id::text
    WHERE d.state='ready' AND d.claimed_at IS NOT NULL
      AND m.kind='document' AND m.direction='outbound' AND m.source='system'
    GROUP BY d.id
    UNION ALL
    SELECT m.id, m.conversation_id, m.id, a.file_name, a.extension, a.size_bytes,
           'whatsapp', 1, m.created_at, a.updated_at
    FROM whatsapp_document_archives a JOIN whatsapp_messages m ON m.id=a.message_id
    WHERE a.environment=$1 AND a.state='available'
      AND m.kind='document' AND m.direction='inbound' AND m.source='customer'
  ), resources AS (
    SELECT r.id, r.environment, r.name, r.remark, r.kind, r.source, r.state, r.mime_type,
           r.size, r.width, r.height, r.version, r.error_code, r.object_key, r.thumbnail_key,
           r.created_at, r.updated_at, r.conversation_id, r.message_id, NULL::text AS extension,
           (SELECT count(*)::int FROM whatsapp_messages m
            WHERE m.attachment->>'mediaAssetId'=r.id::text OR m.id=r.message_id) AS "references"
    FROM oss_resources r WHERE r.environment=$1
    UNION ALL
    SELECT id, $1, file_name, '', CASE WHEN extension='pdf' THEN 'pdf' ELSE 'word' END,
           source, 'ready', NULL, size_bytes, NULL, NULL, NULL, NULL, NULL, NULL,
           created_at, updated_at, conversation_id, message_id, extension, ref_count
    FROM chat_documents
  )`;
