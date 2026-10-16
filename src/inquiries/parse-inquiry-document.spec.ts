import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import WordExtractor from 'word-extractor';
import {
  extractedWord,
  inquiryPdf,
} from '../../test/fixtures/inquiry-document';
import { parseInquiryDocument } from './parse-inquiry-document';

describe('inquiry document import', () => {
  afterEach(() => jest.restoreAllMocks());
  it('extracts real PDF text and preserves line breaks from a Node Buffer', async () => {
    const result = await parseInquiryDocument({
      originalname: 'customer.pdf',
      buffer: inquiryPdf(true),
    });
    expect(result.text).toContain('First line\nSecond line');
  });

  it('rejects a PDF with graphics but no extractable text', async () => {
    await expect(
      parseInquiryDocument({
        originalname: 'scan.pdf',
        buffer: inquiryPdf(false),
      }),
    ).rejects.toMatchObject({
      code: 'INQUIRY_DOCUMENT_SCANNED_UNSUPPORTED',
      message: '不支持扫描件或图片型 PDF',
      status: 400,
    });
  });

  it('rejects corrupt PDF input', async () => {
    await expect(
      parseInquiryDocument({
        originalname: 'broken.pdf',
        buffer: Buffer.from('broken'),
      }),
    ).rejects.toMatchObject({
      code: 'INQUIRY_DOCUMENT_UNPARSEABLE',
      message: '无法解析文档，请检查文件是否损坏或加密',
      status: 400,
    });
  });

  it.each(['txt', 'png', 'pdf.exe'])(
    'rejects unsupported extension %s',
    async (extension) => {
      await expect(
        parseInquiryDocument({
          originalname: `customer.${extension}`,
          buffer: Buffer.from('text'),
        }),
      ).rejects.toMatchObject({
        code: 'INQUIRY_DOCUMENT_INVALID_FORMAT',
        message: '请上传 .doc、.docx 或 .pdf 文档',
        status: 400,
      });
    },
  );

  it('reports a missing file as invalid format', async () => {
    await expect(parseInquiryDocument()).rejects.toMatchObject({
      code: 'INQUIRY_DOCUMENT_INVALID_FORMAT',
      message: '请上传 .doc、.docx 或 .pdf 文档',
      status: 400,
    });
  });

  it('rejects oversized buffers before attempting extraction', async () => {
    const extract = jest.spyOn(WordExtractor.prototype, 'extract');
    await expect(
      parseInquiryDocument({
        originalname: 'customer.docx',
        buffer: Buffer.alloc(2 * 1024 * 1024 + 1),
      }),
    ).rejects.toMatchObject({
      code: 'INQUIRY_DOCUMENT_TOO_LARGE',
      message: '文档不能超过 2 MiB',
      status: 413,
    });
    expect(extract).not.toHaveBeenCalled();
  });

  it.each(['doc', 'docx'])(
    'still extracts real %s documents',
    async (extension) => {
      const result = await parseInquiryDocument({
        originalname: `customer.${extension}`,
        buffer: readFileSync(
          join(__dirname, 'fixtures', `message.${extension}`),
        ),
      });
      expect(result.text.trim().length).toBeGreaterThan(0);
      expect(result.text).not.toContain('\r');
    },
  );

  it('reports empty Word text separately from scanned PDFs', async () => {
    jest
      .spyOn(WordExtractor.prototype, 'extract')
      .mockResolvedValue(extractedWord(' \r\n', ' \t'));
    await expect(
      parseInquiryDocument({
        originalname: 'empty.docx',
        buffer: Buffer.from('word'),
      }),
    ).rejects.toMatchObject({
      code: 'INQUIRY_DOCUMENT_EMPTY_TEXT',
      message: '文档中没有可提取的文字',
      status: 400,
    });
  });

  it('reports Word extraction failures including password errors as unparseable', async () => {
    jest
      .spyOn(WordExtractor.prototype, 'extract')
      .mockRejectedValue(new Error('Encrypted document'));
    await expect(
      parseInquiryDocument({
        originalname: 'encrypted.doc',
        buffer: Buffer.from('word'),
      }),
    ).rejects.toMatchObject({
      code: 'INQUIRY_DOCUMENT_UNPARSEABLE',
      message: '无法解析文档，请检查文件是否损坏或加密',
      status: 400,
    });
  });

  it('checks the combined extracted body and textboxes at the text limit', async () => {
    const extract = jest.spyOn(WordExtractor.prototype, 'extract');
    extract.mockResolvedValueOnce(extractedWord('a'.repeat(199998), 'b'));
    await expect(
      parseInquiryDocument({
        originalname: 'limit.docx',
        buffer: Buffer.alloc(2 * 1024 * 1024),
      }),
    ).resolves.toEqual({ text: `${'a'.repeat(199998)}\nb` });
    extract.mockResolvedValueOnce(extractedWord('a'.repeat(199999), 'b'));
    await expect(
      parseInquiryDocument({
        originalname: 'long.docx',
        buffer: Buffer.from('word'),
      }),
    ).rejects.toMatchObject({
      code: 'INQUIRY_DOCUMENT_TOO_LONG',
      message: '文档文字不能超过 200,000 字符',
      status: 400,
    });
  });
});
