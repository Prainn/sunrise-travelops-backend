import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import WordExtractor from 'word-extractor';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { InquiriesController } from '../src/inquiries/inquiries.controller';
import { InquiriesService } from '../src/inquiries/inquiries.service';
import * as documentParser from '../src/inquiries/parse-inquiry-document';
import { extractedWord, inquiryPdf } from './fixtures/inquiry-document';

describe('inquiry document upload and global error responses', () => {
  let app: INestApplication;
  let server: Server;
  const path = '/api/inquiries/parse-document';

  beforeAll(async () => {
    // The actual controller and multipart interceptor; no database or AppModule.
    const module = await Test.createTestingModule({
      controllers: [InquiriesController],
      providers: [{ provide: InquiriesService, useValue: {} }],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useLogger(false);
    app.useGlobalFilters(new ApiExceptionFilter());
    app.useGlobalInterceptors(new ResponseInterceptor(new Reflector()));
    await app.init();
    server = app.getHttpServer() as Server;
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => app.close());

  it.each([
    {
      filename: 'scanned.pdf',
      buffer: inquiryPdf(false),
      code: 'INQUIRY_DOCUMENT_SCANNED_UNSUPPORTED',
      message: '不支持扫描件或图片型 PDF',
    },
    {
      filename: 'broken.pdf',
      buffer: Buffer.from('broken'),
      code: 'INQUIRY_DOCUMENT_UNPARSEABLE',
      message: '无法解析文档，请检查文件是否损坏或加密',
    },
    {
      filename: 'unsupported.txt',
      buffer: Buffer.from('text'),
      code: 'INQUIRY_DOCUMENT_INVALID_FORMAT',
      message: '请上传 .doc、.docx 或 .pdf 文档',
    },
    {
      filename: 'empty.docx',
      buffer: Buffer.from('word'),
      text: ' \t\r\n',
      code: 'INQUIRY_DOCUMENT_EMPTY_TEXT',
      message: '文档中没有可提取的文字',
    },
    {
      filename: 'long.doc',
      buffer: Buffer.from('word'),
      text: 'a'.repeat(200001),
      code: 'INQUIRY_DOCUMENT_TOO_LONG',
      message: '文档文字不能超过 200,000 字符',
    },
  ])(
    'preserves $code and the original Chinese message through the filter',
    async ({ filename, buffer, text, code, message }) => {
      if (text !== undefined)
        jest
          .spyOn(WordExtractor.prototype, 'extract')
          .mockResolvedValue(extractedWord(text));
      const response = await request(server)
        .post(path)
        .set('X-Request-Id', 'document-error-test')
        .attach('file', buffer, filename)
        .expect(400);
      expect(response.body).toMatchObject({
        code,
        message,
        data: null,
        details: {},
        path,
        requestId: 'document-error-test',
      });
      expect(response.body).toHaveProperty('timestamp', expect.any(String));
    },
  );

  it('returns invalid-format code when the multipart file is missing', async () => {
    const response = await request(server).post(path).expect(400);
    expect(response.body).toMatchObject({
      code: 'INQUIRY_DOCUMENT_INVALID_FORMAT',
      message: '请上传 .doc、.docx 或 .pdf 文档',
      data: null,
    });
  });

  it('returns the too-large business code for Multer rejection before the handler', async () => {
    const parse = jest.spyOn(documentParser, 'parseInquiryDocument');
    const response = await request(server)
      .post(path)
      .set('X-Request-Id', 'document-size-test')
      .attach('file', Buffer.alloc(2 * 1024 * 1024 + 1), 'large.pdf')
      .expect(413);
    expect(parse).not.toHaveBeenCalled();
    expect(response.body).toMatchObject({
      code: 'INQUIRY_DOCUMENT_TOO_LARGE',
      message: '文档不能超过 2 MiB',
      data: null,
      details: {},
      path,
      requestId: 'document-size-test',
    });
    expect(response.body).toHaveProperty('timestamp', expect.any(String));
  });

  it('still returns extracted text in the success envelope', async () => {
    const response = await request(server)
      .post(path)
      .attach('file', inquiryPdf(true), 'customer.PDF')
      .expect(201);
    expect(response.body).toMatchObject({
      code: 'SUCCESS',
      message: 'success',
    });
    expect(response.body).toHaveProperty(
      'data.text',
      expect.stringContaining('First line\nSecond line'),
    );
  });
});
