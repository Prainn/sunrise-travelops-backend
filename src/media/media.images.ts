import sharp from 'sharp';
sharp.concurrency(1);
sharp.cache({ memory: 16, files: 0, items: 20 });
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const PROVIDER_MEDIA_ORIGIN =
  'https://bucket-chatapp-file-internal.oss-ap-southeast-1.aliyuncs.com';

export function providerMediaUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 8192)
    throw new Error('MEDIA_URL_INVALID');
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new Error('MEDIA_URL_INVALID');
  }
  if (u.origin !== PROVIDER_MEDIA_ORIGIN || u.username || u.password || u.hash)
    throw new Error('MEDIA_URL_INVALID');
  return u.href;
}
export async function downloadProviderMedia(value: unknown): Promise<Buffer> {
  const url = providerMediaUrl(value);
  const response = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw new Error(
      response.status === 403
        ? 'MEDIA_SOURCE_EXPIRED'
        : 'MEDIA_DOWNLOAD_FAILED',
    );
  if (
    Number(response.headers.get('content-length') ?? 0) > MAX_IMAGE_BYTES ||
    !response.body
  )
    throw new Error('MEDIA_TOO_LARGE');
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_IMAGE_BYTES) throw new Error('MEDIA_TOO_LARGE');
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel();
  }
}
export async function prepareImage(bytes: Buffer, kind: 'image' | 'sticker') {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES)
    throw new Error('MEDIA_TOO_LARGE');
  const image = sharp(bytes, { limitInputPixels: 40000000, failOn: 'error' });
  const meta = await image.metadata().catch(() => {
    throw new Error('MEDIA_TYPE_INVALID');
  });
  const types: Record<string, { mime: string; ext: string }> = {
    jpeg: { mime: 'image/jpeg', ext: 'jpg' },
    png: { mime: 'image/png', ext: 'png' },
    webp: { mime: 'image/webp', ext: 'webp' },
    gif: { mime: 'image/gif', ext: 'gif' },
  };
  const type = types[meta.format ?? ''];
  if (
    !type ||
    !meta.width ||
    !meta.height ||
    meta.width > 12000 ||
    meta.height > 12000 ||
    (kind === 'sticker' && meta.format !== 'webp')
  )
    throw new Error('MEDIA_TYPE_INVALID');
  // Decode pixels too: metadata alone does not prove an image is valid.
  const thumbnail = await image
    .clone()
    .rotate()
    .resize({
      width: 480,
      height: 480,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: 75 })
    .toBuffer()
    .catch(() => {
      throw new Error('MEDIA_TYPE_INVALID');
    });
  const send =
    kind === 'image' && !['jpeg', 'png'].includes(meta.format)
      ? await image
          .clone()
          .rotate()
          .flatten({ background: '#ffffff' })
          .jpeg({ quality: 90 })
          .toBuffer()
      : null;
  if (send && send.length > MAX_IMAGE_BYTES) throw new Error('MEDIA_TOO_LARGE');
  return {
    original: bytes,
    thumbnail: kind === 'image' ? thumbnail : null,
    send,
    ...type,
    width: meta.width,
    height: meta.height,
  };
}
