import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { databaseSsl } from './database-ssl';

describe('database TLS configuration', () => {
  it('keeps local database TLS disabled and server validation enabled', () => {
    expect(databaseSsl('false', undefined)).toBe(false);
    expect(databaseSsl('true', undefined)).toEqual({
      rejectUnauthorized: true,
    });
  });

  it('loads the selected CA and rejects a missing CA file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'sunrise-ca-test-'));
    try {
      const ca = join(directory, 'ca.pem');
      writeFileSync(ca, 'test certificate');
      expect(databaseSsl('true', ca)).toEqual({
        rejectUnauthorized: true,
        ca: 'test certificate',
      });
      expect(() =>
        databaseSsl('true', join(directory, 'missing.pem')),
      ).toThrow();
    } finally {
      rmSync(directory, { recursive: true });
    }
  });
});
