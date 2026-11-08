import { jest } from '@jest/globals';
import { act } from '@testing-library/react-native';
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

type EngineState = 'opening' | 'open' | 'closing' | 'closed';

/** One websocket attempt. The Manager replaces it with a fresh one on a reconnect, and a detached one settles on its own. */
export class FakeEngine {
  readyState: EngineState = 'closed';
  readonly close = jest.fn(() => {
    this.readyState = 'closed';
    return this;
  });
  private listeners = new Map<string, Listener[]>();

  once(event: 'open' | 'error', fn: Listener): this {
    const wrapper = Object.assign((...args: never[]) => {
      this.off(event, wrapper);
      fn(...args);
    }, { inner: fn });
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), wrapper]);
    return this;
  }

  off(event: 'open' | 'error', fn: Listener): this {
    this.listeners.set(event, (this.listeners.get(event) ?? []).filter((l) => l !== fn && (l as { inner?: Listener }).inner !== fn));
    return this;
  }

  /** This attempt's websocket opening, whichever socket now owns the Manager. */
  open(): void {
    this.readyState = 'open';
    [...(this.listeners.get('open') ?? [])].forEach((l) => (l as () => void)());
  }
}

/** The socket's Manager: its engine's state, and the `open` / `error` it raises as that engine settles. */
class FakeManager {
  readonly reconnection = jest.fn();
  engine: FakeEngine | undefined = new FakeEngine();
  private listeners = new Map<string, Listener[]>();

  once(event: 'open' | 'error', fn: Listener): this {
    const wrapper = Object.assign((...args: never[]) => {
      this.off(event, wrapper);
      fn(...args);
    }, { inner: fn });
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), wrapper]);
    return this;
  }

  off(event: 'open' | 'error', fn: Listener): this {
    this.listeners.set(event, (this.listeners.get(event) ?? []).filter((l) => l !== fn && (l as { inner?: Listener }).inner !== fn));
    return this;
  }

  emit(event: 'open' | 'error', ...args: unknown[]): void {
    [...(this.listeners.get(event) ?? [])].forEach((l) => (l as (...a: unknown[]) => void)(...args));
  }
}

/**
 * The client socket `io()` hands lib/socket.ts. It never talks to anything: a test plays the
 * server through `serverEmit`, `open` and the acks it reads back.
 */
export class FakeSocket {
  connected = false;
  active = false;
  readonly sent: { event: keyof Outgoing; args: unknown[] }[] = [];
  readonly acks: PendingAck[] = [];
  /** Set, every ack is answered with it as it is sent, as a server that takes every intent does. */
  answering: IntentReply | null = null;
  /** The latest credentials lib/socket.ts handed over, as each connection attempt asks for them. */
  credentials: Promise<Record<string, unknown>> | null = null;
  readonly connect = jest.fn(() => {
    this.attempt();
    return this;
  });
  readonly disconnect = jest.fn(() => {
    this.active = false;
    this.io.engine?.close();
    if (this.connected) this.drop('io client disconnect');
    return this;
  });
  readonly io = new FakeManager();
  private readonly listeners = new Map<string, Listener[]>();
  /** How often each event was subscribed and unsubscribed over the socket's life. */
  readonly subscriptions = new Map<string, { on: number; off: number }>();
  private readonly unanswered = new Set<() => void>();

  readonly uri: string;
  readonly options: { auth?: AuthCallback; autoConnect?: boolean } & Record<string, unknown>;

  constructor(uri: string, options: { auth?: AuthCallback; autoConnect?: boolean } & Record<string, unknown>) {
    this.uri = uri;
    this.options = options;
    if (options.autoConnect !== false) this.attempt();
  }

  private attempt(): void {
    if (this.connected) return;
    this.active = true;
    if (!this.io.engine || this.io.engine.readyState === 'closed') this.io.engine = new FakeEngine();
    this.io.engine.readyState = 'opening';
    this.credentials = this.handshake();
  }

  private count(event: string, way: 'on' | 'off'): void {
    const tally = this.subscriptions.get(event) ?? { on: 0, off: 0 };
    this.subscriptions.set(event, { ...tally, [way]: tally[way] + 1 });
  }

  on(event: string, fn: Listener): this {
    this.count(event, 'on');
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), fn]);
    return this;
  }

  off(event: string, fn?: Listener): this {
    this.count(event, 'off');
    if (!fn) {
      this.listeners.delete(event);
      return this;
    }
    const list = this.listeners.get(event) ?? [];
    const at = list.findIndex((l) => l === fn || (l as { inner?: Listener }).inner === fn);
    if (at >= 0) this.listeners.set(event, [...list.slice(0, at), ...list.slice(at + 1)]);
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
    return this.listeners.get(event)?.length ?? 0;
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
          // A reply crosses the wire, so it lands after the emit returns; a promise, as fake timers hold queueMicrotask.
          answer: (reply) => void Promise.resolve().then(() => settle(() => ack(null, reply))),
        };
        const settle = (call: () => void) => {
          if (pending.settled) return;
          pending.settled = true;
          clearTimeout(timer);
          this.unanswered.delete(drop);
          call();
        };
        const drop = () => settle(() => {});
        this.unanswered.add(drop);
        this.acks.push(pending);
        if (this.answering) pending.answer(this.answering);
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

  /** `serverEmit` as one act: what a mounted screen shows once the server has said it. */
  async deliver<E extends keyof Incoming>(event: E, ...args: Parameters<Incoming[E]>): Promise<void> {
    await act(async () => this.serverEmit(event, ...args));
  }

  /** Every ack still out, never answered: its timer would outlive the test that sent it. */
  abandonAcks(): void {
    [...this.unanswered].forEach((drop) => drop());
  }

  /** The handshake succeeding: the engine opens, then the namespace connects unless that closed it. */
  open(): void {
    this.io.engine!.open();
    this.io.emit('open');
    if (this.io.engine?.readyState !== 'open') return;
    this.connected = true;
    this.active = true;
    this.serverEmit('connect');
  }

  /** The connection lost from the server's side; socket.io keeps reconnecting. */
  drop(reason: string): void {
    this.connected = false;
    this.io.engine!.readyState = 'closed';
    this.serverEmit('disconnect', reason);
  }

  /** The server's middleware refusing the handshake: socket.io gives up on this socket. */
  refuse(err: Error): void {
    this.active = false;
    this.io.engine!.readyState = 'closed';
    this.serverEmit('connect_error', err);
  }

  /** The engine failing before it opened, as a refused upgrade does. */
  failToOpen(err: Error): void {
    this.active = false;
    this.io.engine!.readyState = 'closed';
    this.io.emit('error', err);
    this.serverEmit('connect_error', err);
  }

  /** One attempt asking lib/socket.ts for its credentials, as socket.io does before each connection. */
  handshake(): Promise<Record<string, unknown>> {
    return new Promise((resolve) => this.options.auth?.(resolve));
  }

  /**
   * Clears what a test reads back and nothing the app holds: lib/socket.ts keeps one socket per
   * account for the whole file, and what subscribed to it stays subscribed, as on a device.
   */
  reset(): void {
    this.sent.length = 0;
    this.acks.length = 0;
    this.connect.mockClear();
    this.disconnect.mockClear();
    this.io.reconnection.mockClear();
    this.answering = null;
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
