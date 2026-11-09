import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import MnsClient from '@alicloud/mns';
import { WhatsappConfig } from './whatsapp.config';
import { WhatsappEvents } from './whatsapp.events';
import { WhatsappService } from './whatsapp.service';
import { WhatsappQueueToken } from './whatsapp.queue-token';
@Injectable()
export class WhatsappWorker implements OnModuleInit, OnModuleDestroy {
  private stopped = false;
  private jobs: Promise<void>[] = [];
  private logger = new Logger(WhatsappWorker.name);
  private timers = new Map<NodeJS.Timeout, () => void>();
  constructor(
    private readonly config: WhatsappConfig,
    private readonly events: WhatsappEvents,
    private readonly service: WhatsappService,
    private readonly queueToken: WhatsappQueueToken,
  ) {}
  onModuleInit() {
    this.config.validate();
    if (!this.config.workerEnabled) return;
    this.jobs.push(
      this.loop(async () => {
        for (let i = 0; i < 25 && !this.stopped; i++)
          if (!(await this.events.processOne())) break;
      }, 1000),
    );
    this.jobs.push(
      this.loop(async () => {
        for (let i = 0; i < 10 && !this.stopped; i++)
          if (!(await this.service.dispatchOne())) break;
      }, 1000),
    );
    if (this.config.mode === 'queue')
      for (const kind of ['inbound', 'status'] as const)
        this.jobs.push(this.consume(kind));
  }
  private pause(ms: number) {
    return new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        this.timers.delete(t);
        resolve();
      }, ms);
      this.timers.set(t, resolve);
    });
  }
  private async loop(work: () => Promise<void>, interval: number) {
    while (!this.stopped) {
      try {
        await work();
      } catch {
        this.logger.warn(
          'WhatsApp worker iteration failed; retry scheduled (payload suppressed)',
        );
      }
      if (!this.stopped) await this.pause(interval);
    }
  }
  private async consume(kind: 'inbound' | 'status') {
    const queue = this.config.get(
      kind === 'inbound' ? 'INBOUND_QUEUE' : 'STATUS_QUEUE',
    );
    let client: MnsClient | undefined,
      expires = 0;
    await this.loop(async () => {
      if (!client || Date.now() >= expires) {
        const token = await this.queueToken.get(kind);
        expires = Math.min(token.expiresAt - 60000, Date.now() + 240000);
        const endpoint = this.config.get('MNS_ENDPOINT');
        client = new MnsClient(new URL(endpoint).hostname.split('.')[0], {
          endpoint,
          accessKeyId: token.accessKeyId,
          accessKeySecret: token.accessKeySecret,
          securityToken: token.securityToken,
          secure: true,
          readTimeout: 30000,
          connectTimeout: 5000,
        });
      }
      try {
        const response = await client.receiveMessage(queue, 20);
        const body = response.body;
        if (!body?.MessageBody || !body.ReceiptHandle)
          throw new Error('QUEUE_BODY_INVALID');
        const decoded = Buffer.from(body.MessageBody, 'base64').toString(
          'utf8',
        );
        let payload: unknown;
        try {
          payload = JSON.parse(decoded);
        } catch {
          payload = { invalidQueueBody: decoded };
        }
        await this.events.receive(payload, kind);
        // Ack only after local persistence. Re-delivery is safe after an ack/network failure.
        await client.deleteMessage(queue, body.ReceiptHandle);
      } catch (error) {
        if (error instanceof Error && error.name === 'MNSMessageNotExistError')
          return;
        throw error;
      }
    }, 1000);
  }
  async onModuleDestroy() {
    this.stopped = true;
    for (const [timer, resolve] of this.timers) {
      clearTimeout(timer);
      resolve();
    }
    this.timers.clear();
    await Promise.allSettled(this.jobs);
  }
}
