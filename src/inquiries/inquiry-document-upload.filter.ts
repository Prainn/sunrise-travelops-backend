import { ArgumentsHost, Catch, PayloadTooLargeException } from '@nestjs/common';
import { ErrorCode } from '../common/constants/error-code';
import { BusinessException } from '../common/exceptions/business.exception';
import { ApiExceptionFilter } from '../common/filters/api-exception.filter';

/** Multer rejects oversized uploads before parseDocument can inspect the buffer. */
@Catch(PayloadTooLargeException)
export class InquiryDocumentUploadFilter extends ApiExceptionFilter {
  override catch(
    exception: PayloadTooLargeException,
    host: ArgumentsHost,
  ): void {
    super.catch(
      new BusinessException({
        code: ErrorCode.INQUIRY_DOCUMENT_TOO_LARGE,
        message: '文档不能超过 2 MiB',
        status: exception.getStatus(),
      }),
      host,
    );
  }
}
