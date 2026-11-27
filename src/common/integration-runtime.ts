import { IsBoolean, IsInt, Min, ValidateIf } from 'class-validator';
import { BusinessException } from './exceptions/business.exception';

export class UpdateIntegrationRuntimeDto {
  @IsInt() @Min(1) version: number;

  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsBoolean()
  inboundEnabled?: boolean;

  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsBoolean()
  outboundEnabled?: boolean;
}

export function integrationEnvironment(databaseName?: string) {
  if (databaseName === 'travelops_dev') return 'dev';
  if (databaseName === 'travelops_prod') return 'prod';
  return 'local';
}

export function outboundPaused(): never {
  throw new BusinessException({
    code: 'CONFLICT',
    message: '出站发送已暂停',
    status: 409,
    details: { reason: 'OUTBOUND_PAUSED' },
  });
}
