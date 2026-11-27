/** A late customer callback can have a higher seq than the phone reply it preceded. */
export function unreadWhatsappMessageSql(conversationId: 'c.id' | '$1') {
  return `m.direction='inbound'
    AND m.seq>coalesce((SELECT max(r.last_seq) FROM whatsapp_reads r WHERE r.conversation_id=${conversationId}),0)
    AND NOT EXISTS (
      SELECT 1 FROM whatsapp_messages reply
      WHERE reply.conversation_id=${conversationId} AND reply.direction='outbound' AND reply.source='mobile'
        AND reply.kind NOT IN ('reaction','edit','system') AND reply.status<>'failed'
        AND reply.occurred_at>m.occurred_at
        AND NOT EXISTS (SELECT 1 FROM whatsapp_events imported WHERE imported.message_id=reply.id AND imported.kind='history_import')
    )`;
}
