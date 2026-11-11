import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthenticatedUser } from '../auth/auth.types';
import { WebsiteService } from '../website/website.service';
import { WhatsappConfig } from './whatsapp.config';
import { WhatsappService } from './whatsapp.service';
import { WhatsappProvider } from './whatsapp.provider';
import { WhatsappEvents } from './whatsapp.events';
import { WhatsappQueueToken } from './whatsapp.queue-token';
import { WhatsappWorker } from './whatsapp.worker';

const root: AuthenticatedUser = {
  id: 'root',
  username: 'mango',
  nickname: 'root',
  identityId: 'root-identity',
  scope: 'headquarters',
  scopeName: '',
  deptId: null,
  deptName: '',
  roles: ['ROOT'],
  menuKeys: [],
  permissions: ['whatsapp:integration:manage'],
};
describe('WhatsApp current-process worker diagnostics', () => {
  let service: WhatsappService;
  let worker: WhatsappWorker;
  const processOne = jest.fn<Promise<boolean>, []>();
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const config = new WhatsappConfig(
      new ConfigService({
        WHATSAPP_CHAT_ENABLED: 'true',
        WHATSAPP_CHAT_WORKER_ENABLED: 'true',
        WHATSAPP_CHAT_SPACE_ID: 'synthetic',
        WHATSAPP_CHAT_WABA_ID: 'synthetic',
        WHATSAPP_CHAT_PHONE: '0000000000',
        WHATSAPP_CHAT_RECEIVE_MODE: 'disabled',
      }),
    );
    const query = jest.fn().mockResolvedValue([{}]);
    service = new WhatsappService(
      { query } as unknown as DataSource,
      {} as WebsiteService,
      config,
      {} as WhatsappProvider,
    );
    jest.spyOn(service, 'dispatchOne').mockResolvedValue(false);
    processOne.mockReset().mockResolvedValue(false);
    worker = new WhatsappWorker(
      config,
      { processOne } as unknown as WhatsappEvents,
      service,
      {} as WhatsappQueueToken,
    );
  });
  afterEach(async () => {
    await worker.onModuleDestroy();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });
  it('reports actual idle iterations, failures and recovery separately from enablement', async () => {
    expect((await service.integration(root)).worker.events.state).toBe(
      'starting',
    );
    processOne.mockRejectedValueOnce(new Error('synthetic failure'));
    worker.onModuleInit();
    await jest.advanceTimersByTimeAsync(0);
    let result = await service.integration(root);
    expect(result.worker.events.state).toBe('error');
    expect(result.worker.events.lastErrorAt).toBeInstanceOf(Date);
    expect(result.worker.outbound.state).toBe('running');
    await jest.advanceTimersByTimeAsync(1000);
    result = await service.integration(root);
    expect(result.worker.events.state).toBe('running');
    expect(result.worker.events.lastCompletedAt).toBeInstanceOf(Date);
    await worker.onModuleDestroy();
    expect((await service.integration(root)).worker.outbound.state).toBe(
      'stopped',
    );
  });
  it('flags a blocked iteration after 60 seconds and clears after it completes', async () => {
    let release!: (result: boolean) => void;
    processOne.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          release = resolve;
        }),
    );
    worker.onModuleInit();
    await jest.advanceTimersByTimeAsync(60001);
    expect((await service.integration(root)).worker.events.state).toBe(
      'stalled',
    );
    expect((await service.integration(root)).worker.outbound.state).toBe(
      'running',
    );
    release(false);
    await jest.advanceTimersByTimeAsync(0);
    expect((await service.integration(root)).worker.events.state).toBe(
      'running',
    );
  });
});
