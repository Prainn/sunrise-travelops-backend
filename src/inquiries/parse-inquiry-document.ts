import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import WordExtractor from 'word-extractor';

export interface InquiryDocumentFile {
  originalname: string;
  buffer: Buffer;
}

export async function parseInquiryDocument(file?: InquiryDocumentFile) {
  if (!file || !/\.docx?$/i.test(file.originalname)) {
    throw new BadRequestException('请上传 .doc 或 .docx 文档');
  }
  if (file.buffer.length > 2 * 1024 * 1024) {
    throw new PayloadTooLargeException('文档不能超过 2 MiB');
  }
  let text: string;
  try {
    const document = await new WordExtractor().extract(file.buffer);
    text = [
      document.getBody(),
      document.getTextboxes({ includeHeadersAndFooters: false }),
    ]
      .filter((part) => part.trim())
      .join('\n')
      .replace(/\r\n?/g, '\n');
  } catch {
    throw new BadRequestException('无法解析文档，请检查文件是否损坏或加密');
  }
  if (!text.trim()) throw new BadRequestException('文档中没有可提取的文字');
  if (text.length > 200000)
    throw new BadRequestException('文档文字不能超过 200,000 字符');
  return { text };
}
