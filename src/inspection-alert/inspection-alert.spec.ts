import { ConfigService } from '@nestjs/config';
import { ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { of } from 'rxjs';
import { HttpLogContextInterceptor } from '../common/interceptors/http-log-context.interceptor';
import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator';
import { InspectionAlertController } from './inspection-alert.controller';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { Repository } from 'typeorm';
import { FeishuService } from '../feishu/feishu.service';
import { UserEntity } from '../users/user.entity';
import { InspectionAlertDto } from './inspection-alert.dto';
import { InspectionAlertGuard } from './inspection-alert.guard';
import {
  InspectionAlertService,
  formatInspectionAlert,
} from './inspection-alert.service';

const input: InspectionAlertDto = {
  eventId: 'a5b9aa1a-821d-44d6-a999-cc377ebd2244',
  checkedAt: '2026-10-28T10:00:00+08:00',
  environment: 'production',
  status: 'abnormal',
  severity: 'warning',
  item: 'disk',
  metricPercent: 95,
};
const recipient = 'a5b9aa1a-821d-44d6-a999-cc377ebd2244';
function setup() {
  const users = {
    findOne: jest.fn().mockResolvedValue({
      feishuOpenId: 'ou_test',
      identities: [{ scope: 'headquarters' }],
    }),
  };
  const feishu = {
    sendText: jest
      .fn<Promise<{ messageId: string }>, [string, string, string]>()
      .mockResolvedValue({ messageId: 'mock' }),
  };
  return {
    users,
    feishu,
    service: new InspectionAlertService(
      new ConfigService({ INSPECTION_ALERT_RECIPIENT_USER_ID: recipient }),
      users as unknown as Repository<UserEntity>,
      feishu as unknown as FeishuService,
    ),
  };
}

describe('inspection alerts', () => {
  it('formats only fixed text and UTC time', () => {
    expect(formatInspectionAlert(input)).toContain(
      '2026-10-28T02:00:00.000Z（UTC）',
    );
    expect(formatInspectionAlert(input)).toContain('关键指标：95%');
  });
  it('validates timezone, numeric bounds and unexpected fields', async () => {
    const dto = plainToInstance(InspectionAlertDto, {
      ...input,
      checkedAt: '2026-10-28T10:00:00',
      metricPercent: 101,
      message: 'secret',
    });
    expect(
      (
        await validate(dto, { whitelist: true, forbidNonWhitelisted: true })
      ).map((e) => e.property),
    ).toEqual(
      expect.arrayContaining(['checkedAt', 'metricPercent', 'message']),
    );
  });
  it('is silent for normal and recovery', async () => {
    const { service, feishu } = setup();
    expect(await service.report({ ...input, status: 'normal' })).toEqual({
      result: 'silent',
    });
    expect(await service.report({ ...input, status: 'recovered' })).toEqual({
      result: 'silent',
    });
    expect(feishu.sendText).not.toHaveBeenCalled();
  });
  it('serializes duplicates and sends escalation once', async () => {
    const { service, feishu } = setup();
    const results = await Promise.all([
      service.report(input),
      service.report(input),
    ]);
    expect(results.map((r) => r.result).sort()).toEqual(['duplicate', 'sent']);
    expect(await service.report({ ...input, severity: 'critical' })).toEqual({
      result: 'sent',
    });
    expect(await service.report(input)).toEqual({ result: 'duplicate' });
    expect(feishu.sendText).toHaveBeenCalledTimes(2);
    expect(feishu.sendText.mock.calls[0][2]).not.toBe(
      feishu.sendText.mock.calls[1][2],
    );
  });
  it('bounds simultaneous distinct events and accepts retry after capacity frees', async () => {
    const { service, feishu } = setup();
    let finish!: (value: { messageId: string }) => void;
    const waiting = new Promise<{ messageId: string }>((resolve) => {
      finish = resolve;
    });
    feishu.sendText.mockReturnValue(waiting);
    const reports = Array.from({ length: 100 }, (_, i) =>
      service.report({
        ...input,
        eventId: `a5b9aa1a-821d-44d6-a999-${i.toString().padStart(12, '0')}`,
      }),
    );
    await expect(
      service.report({
        ...input,
        eventId: 'a5b9aa1a-821d-44d6-a999-999999999999',
      }),
    ).rejects.toThrow();
    finish({ messageId: 'mock' });
    await Promise.all(reports);
    await expect(
      service.report({
        ...input,
        eventId: 'a5b9aa1a-821d-44d6-a999-999999999999',
      }),
    ).resolves.toEqual({ result: 'sent' });
  });
  it('treats uppercase and lowercase event UUID as the same event', async () => {
    const { service, feishu } = setup();
    await service.report(input);
    expect(
      await service.report({ ...input, eventId: input.eventId.toUpperCase() }),
    ).toEqual({ result: 'duplicate' });
    expect(feishu.sendText).toHaveBeenCalledTimes(1);
  });
  it('retries a failed send with the same provider id', async () => {
    const { service, feishu } = setup();
    feishu.sendText.mockRejectedValueOnce(new Error('failed'));
    await expect(service.report(input)).rejects.toThrow();
    expect(await service.report(input)).toEqual({ result: 'sent' });
    expect(feishu.sendText.mock.calls[0][2]).toBe(
      feishu.sendText.mock.calls[1][2],
    );
  });
  it('rejects missing or non-headquarters recipient', async () => {
    const { service, users, feishu } = setup();
    users.findOne.mockResolvedValue({
      feishuOpenId: 'ou_test',
      identities: [{ scope: 'website' }],
    });
    await expect(service.report(input)).rejects.toThrow();
    expect(feishu.sendText).not.toHaveBeenCalled();
  });
  it('queries the configured UUID and enabled status, and refuses missing bindings', async () => {
    const { service, users, feishu } = setup();
    users.findOne.mockResolvedValue(null);
    await expect(service.report(input)).rejects.toThrow();
    expect(users.findOne).toHaveBeenCalledWith({
      where: { id: recipient, status: 'enabled' },
      relations: { identities: true },
    });
    users.findOne.mockResolvedValue({
      feishuOpenId: '',
      identities: [{ scope: 'headquarters' }],
    });
    await expect(service.report(input)).rejects.toThrow();
    expect(feishu.sendText).not.toHaveBeenCalled();
  });
  it('rejects invalid types and oversized timestamps', async () => {
    const dto = plainToInstance(InspectionAlertDto, {
      ...input,
      checkedAt: '2026-10-28T10:00:00.12345678901234567890Z',
      metricPercent: '95',
      item: 'raw SQL',
      eventId: 'x'.repeat(100),
    });
    expect((await validate(dto)).map((e) => e.property)).toEqual(
      expect.arrayContaining(['checkedAt', 'metricPercent', 'item', 'eventId']),
    );
  });
  it('binds a dedicated guard and throttle while excluding body from HTTP context', () => {
    const handler = Object.getOwnPropertyDescriptor(
      InspectionAlertController.prototype,
      'report',
    )!.value as (...args: never[]) => unknown;
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toContain(
      InspectionAlertGuard,
    );
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', handler)).toBe(30);
    const response = { locals: {} as Record<string, unknown> };
    const context = {
      getType: () => 'http',
      getClass: () => InspectionAlertController,
      getHandler: () => handler,
      switchToHttp: () => ({
        getRequest: () => ({
          body: { secret: 'private' },
          params: {},
          query: {},
        }),
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext;
    new HttpLogContextInterceptor().intercept(context, {
      handle: () => of(null),
    });
    expect(response.locals.httpLogSource).toEqual(
      expect.objectContaining({ body: undefined }),
    );
    expect(JSON.stringify(response.locals)).not.toContain('private');
  });
  it('requires enabled configuration and the dedicated token', () => {
    const context = (authorization?: string) =>
      ({
        switchToHttp: () => ({
          getRequest: () => ({ headers: { authorization } }),
        }),
      }) as ExecutionContext;
    const token = 'x'.repeat(32);
    expect(() =>
      new InspectionAlertGuard(new ConfigService({})).canActivate(context()),
    ).toThrow();
    const guard = new InspectionAlertGuard(
      new ConfigService({
        INSPECTION_ALERT_ENABLED: 'true',
        INSPECTION_ALERT_TOKEN: token,
        INSPECTION_ALERT_RECIPIENT_USER_ID: recipient,
      }),
    );
    expect(() => guard.canActivate(context())).toThrow();
    expect(() => guard.canActivate(context('Bearer wrong'))).toThrow();
    expect(() =>
      new InspectionAlertGuard(
        new ConfigService({
          INSPECTION_ALERT_ENABLED: 'false',
          INSPECTION_ALERT_TOKEN: token,
          INSPECTION_ALERT_RECIPIENT_USER_ID: recipient,
        }),
      ).canActivate(context(`Bearer ${token}`)),
    ).toThrow();
    expect(guard.canActivate(context(`Bearer ${token}`))).toBe(true);
  });
});
