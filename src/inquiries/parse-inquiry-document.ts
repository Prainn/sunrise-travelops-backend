import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../common/constants/error-code';
import { BusinessException } from '../common/exceptions/business.exception';
import WordExtractor from 'word-extractor';
// 直接引用实现文件，避免包入口的调试代码读取测试文件
// eslint-disable-next-line @typescript-eslint/no-require-imports
const parsePdf = require('pdf-parse/lib/pdf-parse.js') as (
  data: Uint8Array,
) => Promise<{ text: string }>;

export interface InquiryDocumentFile {
  originalname: string;
  buffer: Buffer;
}

export async function parseInquiryDocument(file?: InquiryDocumentFile) {
  if (!file || !/\.(docx?|pdf)$/i.test(file.originalname)) {
    throw new BusinessException({
      code: ErrorCode.INQUIRY_DOCUMENT_INVALID_FORMAT,
      message: '请上传 .doc、.docx 或 .pdf 文档',
      status: HttpStatus.BAD_REQUEST,
    });
  }
  const isPdf = /\.pdf$/i.test(file.originalname);
  if (file.buffer.length > 2 * 1024 * 1024) {
    throw new BusinessException({
      code: ErrorCode.INQUIRY_DOCUMENT_TOO_LARGE,
      message: '文档不能超过 2 MiB',
      status: HttpStatus.PAYLOAD_TOO_LARGE,
    });
  }
  let text: string;
  try {
    if (isPdf) {
      // PDF.js uses slice as a copy; Node Buffer.slice instead shares memory.
      text = (await parsePdf(new Uint8Array(file.buffer))).text.replace(
        /\r\n?/g,
        '\n',
      );
    } else {
      const document = await new WordExtractor().extract(file.buffer);
      text = [
        document.getBody(),
        document.getTextboxes({ includeHeadersAndFooters: false }),
      ]
        .filter((part) => part.trim())
        .join('\n')
        .replace(/\r\n?/g, '\n');
    }
  } catch {
    throw new BusinessException({
      code: ErrorCode.INQUIRY_DOCUMENT_UNPARSEABLE,
      message: '无法解析文档，请检查文件是否损坏或加密',
      status: HttpStatus.BAD_REQUEST,
    });
  }
  if (!text.trim())
    throw new BusinessException({
      code: isPdf
        ? ErrorCode.INQUIRY_DOCUMENT_SCANNED_UNSUPPORTED
        : ErrorCode.INQUIRY_DOCUMENT_EMPTY_TEXT,
      message: isPdf ? '不支持扫描件或图片型 PDF' : '文档中没有可提取的文字',
      status: HttpStatus.BAD_REQUEST,
    });
  if (text.length > 200000)
    throw new BusinessException({
      code: ErrorCode.INQUIRY_DOCUMENT_TOO_LONG,
      message: '文档文字不能超过 200,000 字符',
      status: HttpStatus.BAD_REQUEST,
    });
  return { text };
}
