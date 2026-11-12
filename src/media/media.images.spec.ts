import sharp from 'sharp';
import {
  MAX_IMAGE_BYTES,
  prepareImage,
  providerMediaUrl,
  PROVIDER_MEDIA_ORIGIN,
} from './media.images';
describe('media image boundaries', () => {
  it('only downloads from the observed Alibaba media bucket', () => {
    expect(
      providerMediaUrl(PROVIDER_MEDIA_ORIGIN + '/file.webp?Expires=1'),
    ).toContain('/file.webp');
    for (const value of [
      null,
      'not-url',
      'http://127.0.0.1/',
      'http://100.100.100.200/',
      PROVIDER_MEDIA_ORIGIN + '.evil.test/x',
      'https://x:secret@' + new URL(PROVIDER_MEDIA_ORIGIN).host + '/x',
    ])
      expect(() => providerMediaUrl(value)).toThrow('MEDIA_URL_INVALID');
  });
  it('keeps the original and generates a small thumbnail and compatible send image', async () => {
    const bytes = await sharp({
      create: { width: 800, height: 600, channels: 4, background: '#ff000080' },
    })
      .webp()
      .toBuffer();
    const p = await prepareImage(bytes, 'image');
    expect(p.original).toEqual(bytes);
    expect((await sharp(p.thumbnail!).metadata()).width).toBe(480);
    expect((await sharp(p.send!).metadata()).format).toBe('jpeg');
    const sticker = await prepareImage(bytes, 'sticker');
    expect(sticker.original).toEqual(bytes);
    expect(sticker.thumbnail).toBeNull();
    expect(sticker.send).toBeNull();
  });
  it('rejects oversized, corrupt and active-content files', async () => {
    await expect(
      prepareImage(Buffer.alloc(MAX_IMAGE_BYTES + 1), 'image'),
    ).rejects.toThrow('MEDIA_TOO_LARGE');
    await expect(
      prepareImage(Buffer.from('not-an-image'), 'image'),
    ).rejects.toThrow('MEDIA_TYPE_INVALID');
    await expect(
      prepareImage(
        Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"></svg>',
        ),
        'image',
      ),
    ).rejects.toThrow('MEDIA_TYPE_INVALID');
  });
});
