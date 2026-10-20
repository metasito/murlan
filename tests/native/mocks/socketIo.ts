import { jest } from '@jest/globals';
import type { ClientToServerEvents, IntentReply, ServerToClientEvents } from '@/shared/protocol';

type Listener = (...args: never[]) => void;

/** What socket.io itself raises on a client socket, beside the server's events. */
interface ReservedEvents {
  connect: () => void;
  disconnect: (reason: string) => void;
  connect_error: (err: Error) => void;
}
type Incoming = ServerToClientEvents & ReservedEvents;
type Outgoing = ClientToServerEvents;

/** One `socket.timeout(ms).emit(...)`: answered by the test, or failed by its own timer as socket.io's is. */
export interface PendingAck<E extends keyof Outgoing = keyof Outgoing> {
  readonly event: E;
  readonly payload: Parameters<Outgoing[E]>[0];
  readonly timeoutMs: number;
  settled: boolean;
  answer(reply?: IntentReply): void;
}

type AuthCallback = (cb: (data: Record<string, unknown>) => void) => void;

/**
 * The client socket `io()` hands lib/socket.ts. It never talks to anything: a test plays the
 * server through `serverEmit`, `open` and the acks it reads back.
 */
export class FakeSocket {
  connected = false;
  active = true;
  readonly sent: { event: keyof Outgoing; args: unknown[] }[] = [];
  readonly acks: PendingAck[] = [];
  readonly connect = jest.fn(() => this);
  readonly disconnect = jest.fn(() => {
    this.connected = false;
    return this;
  });
  readonly io = { reconnection: jest.fn() };
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(
    readonly uri: string,
    readonly options: { auth?: AuthCallback } & Record<string, unknown>
  ) {}

  on(event: string, fn: Listener): this {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
    return this;
  }

  off(event: string, fn?: Listener): this {
    if (!fn) {
      this.listeners.delete(event);
      return this;
    }
    const set = this.listeners.get(event);
    set?.forEach((l) => {
      if (l === fn || (l as { inner?: Listener }).inner === fn) set.delete(l);
    });
    return this;
  }

  once(event: string, fn: Listener): this {
    const wrapper = Object.assign((...args: never[]) => {
      this.off(event, wrapper);
      fn(...args);
    }, { inner: fn });
    return this.on(event, wrapper);
  }

  removeAllListeners(): this {
    this.listeners.clear();
    return this;
  }

  listening(event: keyof Incoming): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  emit(event: keyof Outgoing, ...args: unknown[]): this {
    this.sent.push({ event, args });
    return this;
  }

  timeout(timeoutMs: number) {
    return {
      emit: (event: keyof Outgoing, payload: unknown, ack: (err: unknown, reply?: IntentReply) => void) => {
        this.sent.push({ event, args: [payload] });
        const timer = setTimeout(() => settle(() => ack(new Error('operation has timed out'))), timeoutMs);
        const pending: PendingAck = {
          event,
          payload: payload as never,
          timeoutMs,
          settled: false,
          answer: (reply) => settle(() => ack(null, reply)),
        };
        const settle = (call: () => void) => {
          if (pending.settled) return;
          pending.settled = true;
          clearTimeout(timer);
          call();
        };
        this.acks.push(pending);
      },
    };
  }

  /** The payloads the client sent as `event`, oldest first. */
  sentAs<E extends keyof Outgoing>(event: E): Parameters<Outgoing[E]>[0][] {
    return this.sent.filter((s) => s.event === event).map((s) => s.args[0] as Parameters<Outgoing[E]>[0]);
  }

  /** The server sending `event`, or socket.io raising one of its own. */
  serverEmit<E extends keyof Incoming>(event: E, ...args: Parameters<Incoming[E]>): void {
    [...(this.listeners.get(event) ?? [])].forEach((l) => (l as (...a: unknown[]) => void)(...args));
  }

  /** The handshake succeeding. */
  open(): void {
    this.connected = true;
    this.active = true;
    this.serverEmit('connect');
  }

  /** One handshake attempt asking lib/socket.ts for its credentials, as socket.io does before each. */
  handshake(): Promise<Record<string, unknown>> {
    return new Promise((resolve) => this.options.auth?.(resolve));
  }

  /** Back to a fresh socket's state, keeping its identity: lib/socket.ts holds one per account for the whole file. */
  reset(): void {
    this.connected = false;
    this.active = true;
    this.sent.length = 0;
    this.acks.length = 0;
    this.listeners.clear();
    this.connect.mockClear();
    this.disconnect.mockClear();
    this.io.reconnection.mockClear();
  }
}

/** Every socket `io()` made in this file, oldest first. */
export function fakeSockets(): FakeSocket[] {
  const g = globalThis as { __fakeSockets?: FakeSocket[] };
  g.__fakeSockets ??= [];
  return g.__fakeSockets;
}

/** The socket `io()` made last. */
export function lastSocket(): FakeSocket {
  const socket = fakeSockets().at(-1);
  if (!socket) throw new Error('no socket was opened');
  return socket;
}

export function socketIoModule() {
  // The server a device build names; set only for a file that loads socket.io, since the bench reads its absence.
  process.env.EXPO_PUBLIC_DOMAIN ??= 'murlan.test';
  return {
    io: (uri: string, options: ConstructorParameters<typeof FakeSocket>[1]) => {
      const socket = new FakeSocket(uri, options);
      fakeSockets().push(socket);
      return socket;
    },
  };
}
