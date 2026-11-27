import sharp from 'sharp';
import { MAX_DOCUMENT_BYTES } from '../media/media.document-format';
import { mailFail } from './mail.types';

const IMAGE_NAME = /\.(jpe?g|png|webp|gif|avif|tiff?)$/i;

export function canPreviewMailImage(name: string, size: number) {
  return size > 0 && size <= MAX_DOCUMENT_BYTES && IMAGE_NAME.test(name);
}

export async function renderMailImage(
  body: ReadableStream<Uint8Array>,
  size: number,
  limit: number,
) {
  const bytes = Buffer.alloc(size);
  let offset = 0;
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.length > size) throw new Error('MAIL_IMAGE_SIZE');
      bytes.set(value, offset);
      offset += value.length;
    }
  } finally {
    await reader.cancel();
  }
  if (offset !== size) throw new Error('MAIL_IMAGE_SIZE');

  try {
    const image = sharp(bytes, {
      limitInputPixels: 40_000_000,
      failOn: 'error',
    });
    const meta = await image.metadata();
    if (
      !['jpeg', 'png', 'webp', 'gif', 'tiff'].includes(meta.format) &&
      !(meta.format === 'heif' && meta.compression === 'av1')
    )
      throw new Error('MAIL_IMAGE_TYPE');
    return await image
      .autoOrient()
      .resize(limit, limit, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    mailFail('VALIDATION_ERROR', '附件图片格式无效或无法预览', 400);
  }
}
