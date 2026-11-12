import { Injectable } from '@nestjs/common';
import { request } from 'node:http';
import { MediaConfig } from './media.config';

/** Environment-specific Unix socket; cloud credentials never enter API containers. */
@Injectable()
export class MediaStorage {
  constructor(private readonly config: MediaConfig) {}
  call<T>(body: Record<string, unknown>): Promise<T> {
    this.config.assertEnabled();
    return new Promise((resolve, reject) => {
      const req = request(
        {
          socketPath: this.config.socket,
          path: '/objects',
          method: 'POST',
          headers: { 'content-type': 'application/json' },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk: Buffer) => {
            data += chunk.toString('utf8');
            if (data.length > 2 * 1024 * 1024)
              res.destroy(new Error('OSS_RESPONSE_TOO_LARGE'));
          });
          res.on('error', () => reject(new Error('OSS_UNAVAILABLE')));
          res.on('end', () => {
            if (res.statusCode !== 200)
              return reject(new Error('OSS_UNAVAILABLE'));
            try {
              resolve(JSON.parse(data) as T);
            } catch {
              reject(new Error('OSS_RESPONSE_INVALID'));
            }
          });
        },
      );
      req.setTimeout(45000, () => req.destroy());
      req.on('error', () => reject(new Error('OSS_UNAVAILABLE')));
      req.end(JSON.stringify(body));
    });
  }
  put(key: string, body: Buffer, mime: string) {
    return this.call<{ etag: string }>({
      action: 'put',
      key,
      body: body.toString('base64'),
      mime,
    });
  }
  remove(keys: string[]) {
    return this.call<{ deleted: boolean }>({ action: 'delete', keys });
  }
}
