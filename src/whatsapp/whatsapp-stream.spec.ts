import { EventEmitter } from 'node:events';
import { Logger } from '@nestjs/common';
import { Response } from 'express';
import { DataSource } from 'typeorm';
import { AuthService } from '../auth/auth.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { BusinessException } from '../common/exceptions/business.exception';
import { WhatsappService } from './whatsapp.service';
import { WhatsappStreamService } from './whatsapp-stream.service';
import { parseWhatsappChange, notifyWhatsappChange } from './whatsapp-changes';

const mockListeners: FakeListener[] = [];
class FakeListener extends EventEmitter {
  constructor() {
    super();
    mockListeners.push(this);
  }
  connect() {
    return Promise.resolve();
  }
  query() {
    return Promise.resolve();
  }
  end() {
    this.emit('end');
    return Promise.resolve();
  }
}
jest.mock('node:module', () => ({
  createRequire: () => () => ({
    Client: function () {
      return new FakeListener();
    },
  }),
}));
class Socket extends EventEmitter {
  frames: string[] = [];
  headers: Record<string, unknown> = {};
  destroyed = false;
  writableEnded = false;
  writableNeedDrain = false;
  writableLength = 0;
  status() {
    return this;
  }
  setHeader(name: string, value: unknown) {
    this.headers[name] = value;
  }
  flushHeaders() {}
  write(frame: string) {
    this.frames.push(frame);
    return true;
  }
  end(frame?: string) {
    if (frame) this.frames.push(frame);
    this.writableEnded = true;
    this.emit('close');
  }
  destroy() {
    this.destroyed = true;
    this.emit('close');
  }
  get text() {
    return this.frames.join('');
  }
}
const id = '00000000-0000-4000-8000-000000000001';
let user: AuthenticatedUser;
let service: WhatsappStreamService;
let current: jest.Mock;
let visible: jest.Mock;
const open = async (actor = user) => {
  const socket = new Socket();
  await service.open(actor, socket as unknown as Response);
  return socket;
};
const notify = (reason: string) =>
  mockListeners.at(-1)!.emit('notification', {
    channel: 'whatsapp_changes',
    payload: JSON.stringify({ conversationId: id, reason }),
  });
beforeEach(async () => {
  jest.useFakeTimers();
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  mockListeners.length = 0;
  user = {
    id: 'user',
    username: 'operator',
    identityId: 'identity',
    scope: 'website',
    scopeName: '',
    nickname: '',
    deptId: null,
    deptName: '',
    roles: ['COORDINATOR'],
    menuKeys: [],
    permissions: ['whatsapp:conversation:list'],
    sessionId: 'session',
    sessionVersion: 1,
    accessExpiresAt: Date.now() + 60000,
  };
  current = jest.fn().mockImplementation(() => Promise.resolve({ ...user }));
  visible = jest.fn().mockResolvedValue([id]);
  service = new WhatsappStreamService(
    { options: { type: 'postgres' } } as DataSource,
    { getCurrentUser: current } as unknown as AuthService,
    { visibleConversationIds: visible } as unknown as WhatsappService,
  );
  await service.onModuleInit();
  await jest.advanceTimersByTimeAsync(400);
});
afterEach(async () => {
  await service.onModuleDestroy();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test('raw ready, heartbeat, fixed coalescing window and summary deduplication', async () => {
  const socket = await open();
  expect(socket.headers['Content-Type']).toBe('text/event-stream');
  expect(socket.text).toMatch(/^event: ready\ndata:/);
  notify('message');
  await jest.advanceTimersByTimeAsync(300);
  notify('read');
  notify('message');
  await jest.advanceTimersByTimeAsync(100);
  expect(socket.text.match(/event: conversation.changed/g)).toHaveLength(1);
  expect(socket.text).toContain('"reasons":["message","read"]');
  expect(socket.text.match(/event: summary.changed/g)).toHaveLength(1);
  await jest.advanceTimersByTimeAsync(19600);
  expect(socket.text).toContain(': ping\n\n');
});
test('lost owner gets ID-free access invalidation, never the filtered conversation ID', async () => {
  const socket = await open();
  visible.mockResolvedValue([]);
  notify('assign');
  await jest.advanceTimersByTimeAsync(400);
  expect(socket.text).toContain('event: access.changed\ndata: {}');
  expect(socket.text).toContain('event: summary.changed');
  expect(socket.text).not.toContain(id);
});
test('expiry timer fires ten seconds before exp and cleans connection timers', async () => {
  const socket = await open();
  await jest.advanceTimersByTimeAsync(50000);
  expect(socket.text).toContain('event: auth.expired\ndata: {}');
  expect(socket.writableEnded).toBe(true);
});
test.each(['session', 'permissions', 'disabled'])(
  'invalidates %s before delivering queued IDs',
  async (change) => {
    const socket = await open();
    if (change === 'permissions')
      current.mockResolvedValue({ ...user, permissions: [] });
    else
      current.mockRejectedValue(
        new BusinessException({
          code: 'AUTH_TOKEN_INVALID',
          message: 'invalid',
          status: 401,
        }),
      );
    notify('message');
    await jest.advanceTimersByTimeAsync(400);
    expect(socket.writableEnded).toBe(true);
    expect(socket.text).toContain('event: access.changed\ndata: {}');
    expect(socket.text).not.toContain(id);
  },
);
test('session invalidation is detected by heartbeat even without notifications', async () => {
  const socket = await open();
  current.mockResolvedValue({ ...user, sessionVersion: 2 });
  await jest.advanceTimersByTimeAsync(20000);
  expect(socket.writableEnded).toBe(true);
  expect(socket.text).toContain('event: access.changed');
});
test('eleventh connection evicts oldest with explicit no-reconnect event', async () => {
  const sockets: Socket[] = [];
  for (let n = 0; n < 11; n++) sockets.push(await open());
  expect(sockets[0].text).toContain('event: connection.limited\ndata: {}');
  expect(sockets[0].writableEnded).toBe(true);
  expect(sockets.slice(1).every((socket) => !socket.writableEnded)).toBe(true);
});
test('LISTEN loss sends resync and closes; unavailable handshake is 503; reconnect restores ready', async () => {
  const socket = await open();
  mockListeners[0].emit('error', new Error('synthetic'));
  expect(socket.text).toContain('event: resync');
  expect(socket.writableEnded).toBe(true);
  await expect(open()).rejects.toMatchObject({ status: 503 });
  await jest.advanceTimersByTimeAsync(2000);
  expect(mockListeners).toHaveLength(2);
  expect((await open()).text).toContain('event: ready');
});
test('resync control, invalid notifications and slow sockets recover without unbounded buffering', async () => {
  const socket = await open();
  mockListeners[0].emit('notification', {
    channel: 'whatsapp_changes',
    payload: '{"type":"resync"}',
  });
  await jest.advanceTimersByTimeAsync(400);
  expect(socket.text).toContain('event: resync');
  socket.writableNeedDrain = true;
  notify('message');
  await jest.advanceTimersByTimeAsync(400);
  expect(socket.destroyed).toBe(true);
  const other = await open();
  mockListeners[0].emit('notification', {
    channel: 'whatsapp_changes',
    payload: '{bad',
  });
  expect(other.writableEnded).toBe(true);
  expect(other.text).toContain('event: resync');
});
test('client close and module destroy release streams and timers', async () => {
  const first = await open(),
    second = await open();
  first.emit('close');
  await service.onModuleDestroy();
  expect(second.writableEnded).toBe(true);
  expect(jest.getTimerCount()).toBe(0);
});
test('rejects malformed/control payloads and transactionless notifications', async () => {
  expect(() =>
    parseWhatsappChange('{"conversationId":"outside","reason":"message"}'),
  ).toThrow();
  expect(() =>
    parseWhatsappChange(
      JSON.stringify({ conversationId: id, reason: 'secret' }),
    ),
  ).toThrow();
  expect(() =>
    parseWhatsappChange('{"type":"resync","text":"private"}'),
  ).toThrow();
  await expect(
    notifyWhatsappChange({} as never, { type: 'resync' }),
  ).rejects.toThrow('TRANSACTION');
});
