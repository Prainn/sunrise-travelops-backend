import type { DocumentExtension } from './media.document-format';

export interface MediaCatalogRow {
  id: string;
  environment: 'dev' | 'prod';
  name: string;
  remark: string;
  kind: 'image' | 'sticker' | 'pdf' | 'word' | 'file';
  source: string;
  state: string;
  mime_type: string | null;
  size: number | null;
  width: number | null;
  height: number | null;
  version: number;
  error_code: string | null;
  object_key: string | null;
  thumbnail_key: string | null;
  created_at: Date;
  updated_at: Date;
  references?: number;
  conversation_id: string | null;
  message_id: string | null;
  extension?: DocumentExtension | null;
  mail_thread_id?: string | null;
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
           NULL::uuid AS mail_thread_id,
           (SELECT count(*)::int FROM whatsapp_messages m
            WHERE m.attachment->>'mediaAssetId'=r.id::text OR m.id=r.message_id) AS "references"
    FROM oss_resources r WHERE r.environment=$1
    UNION ALL
    SELECT d.id, $1, d.file_name, coalesce(n.remark,''), CASE WHEN d.extension='pdf' THEN 'pdf' ELSE 'word' END,
           d.source, 'ready', NULL, d.size_bytes, NULL, NULL, coalesce(n.version,1), NULL, NULL, NULL,
           d.created_at, greatest(d.updated_at,n.updated_at), d.conversation_id, d.message_id, d.extension, NULL, d.ref_count
    FROM chat_documents d LEFT JOIN oss_attachment_remarks n
      ON $3::boolean AND n.environment=$1 AND n.source=d.source AND n.attachment_id=d.id
    UNION ALL
    SELECT a.id, $1, a.file_name, coalesce(n.remark,''),
           CASE lower(substring(a.file_name from '[.]([^.]+)$'))
             WHEN 'pdf' THEN 'pdf'
             WHEN 'doc' THEN 'word'
             WHEN 'docx' THEN 'word'
             WHEN 'jpg' THEN 'image'
             WHEN 'jpeg' THEN 'image'
             WHEN 'png' THEN 'image'
             WHEN 'gif' THEN 'image'
             WHEN 'webp' THEN 'image'
             WHEN 'bmp' THEN 'image'
             WHEN 'tif' THEN 'image'
             WHEN 'tiff' THEN 'image'
             WHEN 'heic' THEN 'image'
             WHEN 'avif' THEN 'image'
             ELSE 'file'
           END,
           'mail', 'ready', NULL, a.size_bytes::float8, NULL, NULL, coalesce(n.version,1), NULL, NULL, NULL,
           m.occurred_at, greatest(m.updated_at,n.updated_at), NULL, NULL, NULL, t.id, 1
    FROM mail_attachments a
    JOIN mail_messages m ON m.id=a.message_id
    JOIN mail_threads t ON t.id=m.thread_id
    LEFT JOIN oss_attachment_remarks n ON n.environment=$1 AND n.source='mail' AND n.attachment_id=a.id
    WHERE $2::boolean AND t.has_inbound AND m.state IN ('received','sent')
      AND a.removed_at IS NULL
      AND a.object_key='private/' || $1 || '/email/' || t.id || '/' || a.id || '.bin'
  )`;
