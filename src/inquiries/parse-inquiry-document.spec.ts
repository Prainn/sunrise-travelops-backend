import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { parseInquiryDocument } from './parse-inquiry-document';

describe('inquiry Word document import', () => {
  it.each(['doc', 'docx'])(
    'extracts %s Unicode text and blank lines',
    async (extension) => {
      const result = await parseInquiryDocument({
        originalname: `message.${extension}`,
        buffer: readFileSync(
          join(__dirname, 'fixtures', `message.${extension}`),
        ),
      });
      expect(result.text).toBe(
        'Dear Monica,\n昆明 15天14晚\n\nDay 1: Arrival\nHotel: 4★\n',
      );
    },
  );

  it('accepts a Word file exactly 2 MiB in size', async () => {
    const buffer = Buffer.alloc(2 * 1024 * 1024);
    readFileSync(join(__dirname, 'fixtures', 'message.doc')).copy(buffer);
    const result = await parseInquiryDocument({
      originalname: 'message.doc',
      buffer,
    });
    expect(result.text).toContain('昆明 15天14晚\n\nDay 1: Arrival');
  });

  it('rejects missing, unsupported, damaged and oversized files', async () => {
    await expect(parseInquiryDocument()).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      parseInquiryDocument({
        originalname: 'message.pdf',
        buffer: Buffer.from('text'),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parseInquiryDocument({
        originalname: 'message.doc',
        buffer: Buffer.from('text'),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parseInquiryDocument({
        originalname: 'message.docx',
        buffer: Buffer.alloc(2 * 1024 * 1024 + 1),
      }),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
  });
});
