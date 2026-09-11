import { readFileSync } from 'node:fs';
import { TlsOptions } from 'node:tls';

export function databaseSsl(
  enabled: string | undefined,
  caPath: string | undefined,
): false | TlsOptions {
  if (enabled !== 'true') return false;
  return {
    rejectUnauthorized: true,
    ...(caPath ? { ca: readFileSync(caPath, 'utf8') } : {}),
  };
}
