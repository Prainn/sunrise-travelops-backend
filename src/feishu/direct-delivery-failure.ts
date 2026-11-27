import { FeishuSendException } from './feishu.service';

export function directDeliveryFailure(error: unknown, attempts: number) {
  if (!(error instanceof FeishuSendException) || error.deliveryUnknown)
    return {
      status: 'unknown',
      errorCode: 'DELIVERY_OUTCOME_UNKNOWN',
      retryAfter: 0,
    };
  const retryAfter = [30, 120, 480][attempts - 1];
  return {
    status: retryAfter === undefined ? 'failed' : 'pending',
    errorCode: 'FEISHU_SEND_FAILED',
    retryAfter: retryAfter ?? 0,
  };
}
