const documentTransfer = /^\/api\/whatsapp\/document-transfer(?:\/|$)/i;

export function privateRequestPath(path: string): string {
  return documentTransfer.test(path)
    ? '/api/whatsapp/document-transfer/[REDACTED]'
    : path;
}
