// A table runtime that records what it was asked to do, for unit tests: every
// send with its address, every writer call, and presence a test sets by hand.
import type { SocketServer } from "../../server/socket/socketTypes.ts";
import type { Emitter, Peers, Presence, TableOutbox, TableStore, TableWriters } from "../../server/game/tableRuntime.ts";
import { createTableRuntime } from "../../server/game/tableRuntime.ts";
import { activeGameStore } from "../../server/store/activeGameStore.ts";
import { roomStore } from "../../server/store/roomStore.ts";
import { tableWriters } from "../../server/game/gamePersistence.ts";
import { TABLE_ANSWER, TABLE_ASK } from "../../server/game/tableRouter.ts";
import type { TableAction } from "../../server/game/tableActions.ts";
import type { Outcome } from "../../server/shared/refusal.ts";
import type { InstanceHandler, InstanceMessage } from "../../server/store/instanceInbox.ts";

export type Address = { room: string } | { user: string };
/** `payload` is `args[0]`, the one argument every event but `game:state`'s ack carries. */
export type SentEntry = { kind: "send"; to: Address; event: string; args: unknown[]; payload: unknown };
export type JournalEntry =
  | SentEntry
  | { kind: "write"; name: string; args: unknown[] }
  | { kind: "store"; name: string; args: unknown[] };

/**
 * Socket.IO as a single instance with nobody connected. The repo's one cast to
 * `SocketServer`; `overrides` replace whole members.
 */
export function stubTransport(overrides: Record<string, unknown> = {}): SocketServer {
  return {
    to: () => ({ emit: () => true, timeout: () => ({ emit: () => true }) }),
    on: () => {},
    serverSideEmit: (...args: unknown[]) => {
      const ack = args.at(-1);
      if (typeof ack === "function") ack(null, []);
      return true;
    },
    sockets: { adapter: { rooms: new Map() }, sockets: new Map() },
    ...overrides,
  } as unknown as SocketServer;
}

/** The only instance: no record names another, no account is anywhere else, and nobody takes a message. */
export function lonePeers(overrides: Partial<Peers> = {}): Peers {
  return {
    self: "this-instance",
    send: async () => {
      throw new Error("no other instance");
    },
    offer: async () => false,
    live: async () => [],
    on: () => {},
    ownerOf: async () => null,
    instanceOf: async () => null,
    heard: () => false,
    stillSubscribed: async () => false,
    ...overrides,
  };
}

/**
 * `owner`, heard lately and subscribed, holds every table: each action forwarded to it is recorded
 * and answered `answerAfterMs` later with what `reply` returns, `"silent"` for no answer at all.
 * Every other message is recorded in `sent`.
 */
export function ownedElsewhere(
  reply: (action: TableAction) => Outcome | undefined | "silent",
  owner = "owner-instance",
  answerAfterMs = 0
) {
  const handlers = new Map<string, InstanceHandler>();
  const asks: { to: string; action: TableAction }[] = [];
  const sent: { to: string; message: InstanceMessage }[] = [];
  const peers: Partial<Peers> = {
    on: (kind, handler) => void handlers.set(kind, handler),
    ownerOf: async () => owner,
    heard: (instance) => instance === owner,
    stillSubscribed: async (instance) => instance === owner,
    send: async (to, message) => {
      if (message.kind !== TABLE_ASK) return void sent.push({ to, message });
      const action = message.action as TableAction;
      asks.push({ to, action });
      const answer = reply(action);
      if (answer === "silent") return;
      const deliver = () => void handlers.get(TABLE_ANSWER)?.({ kind: TABLE_ANSWER, ask: message.ask, outcome: answer });
      if (answerAfterMs > 0) setTimeout(deliver, answerAfterMs);
      else setImmediate(deliver);
    },
  };
  return { peers, asks, sent };
}

/** This instance as the owner other instances forward to: `ask` hands it one action and resolves on its answer. */
export function forwardedTo(options: RecordingOptions = {}) {
  const handlers = new Map<string, InstanceHandler>();
  const waiting = new Map<unknown, (outcome: unknown) => void>();
  const harness = recordingRuntime({
    ...options,
    peers: {
      on: (kind, handler) => void handlers.set(kind, handler),
      send: async (_to, message) => {
        if (message.kind === TABLE_ANSWER) waiting.get(message.ask)?.(message.outcome);
      },
      ...options.peers,
    },
  });
  let asks = 0;
  const ask = (action: unknown) =>
    new Promise<unknown>((resolve) => {
      const id = `ask-${++asks}`;
      waiting.set(id, resolve);
      void handlers.get(TABLE_ASK)?.({ kind: TABLE_ASK, from: "asker-instance", ask: id, action });
    });
  return { ...harness, ask, handlers };
}

export interface RecordingOptions {
  writers?: Partial<TableWriters>;
  presence?: Partial<Presence>;
  transport?: Record<string, unknown>;
  peers?: Partial<Peers>;
  store?: Partial<TableStore>;
  /**
   * "real" runs the production row, status and results writers (`tableWriters`) over
   * the store, so its ordering is under test. A
   * `writers.updateRoomStatus` given with it stands in for the store's, behind the real writer.
   */
  persist?: "real";
}

export function recordingRuntime(options: RecordingOptions = {}) {
  const journal: JournalEntry[] = [];
  const sent: SentEntry[] = [];
  const send = (entry: SentEntry) => {
    journal.push(entry);
    sent.push(entry);
  };
  const missed = new Set<string>();
  const cluster = { online: new Set<string>(), atTable: new Map<string, Set<string>>(), down: false };

  const emitter = (to: Address): Emitter => ({
    emit: (event, ...args) => {
      send({ kind: "send", to, event, args, payload: args[0] });
    },
  });
  const out: TableOutbox = {
    room: (room) => emitter({ room }),
    user: (user) => emitter({ user }),
    state(user, render) {
      const serve = (retrying: boolean) => {
        const state = render(retrying);
        if (state) send({ kind: "send", to: { user }, event: "game:state", args: [state], payload: state });
      };
      serve(false);
      if (missed.delete(user)) serve(true);
    },
  };

  const presence: Presence = {
    isOnline: async (userId) => !cluster.down && cluster.online.has(userId),
    isAtTable: async (userId, roomId) => !cluster.down && (cluster.atTable.get(userId)?.has(roomId) ?? false),
    tablePresence: async (roomId, userIds) =>
      cluster.down
        ? null
        : {
            online: new Set(userIds.filter((u) => cluster.online.has(u))),
            atTable: new Set(userIds.filter((u) => cluster.atTable.get(u)?.has(roomId))),
          },
    onlineAmong: async (userIds) => (cluster.down ? null : new Set(userIds.filter((u) => cluster.online.has(u)))),
    ...options.presence,
  };

  // Journalled when the underlying store settles: the order rows land in, not the order they were asked for.
  const landed = (name: string, args: unknown[]) => journal.push({ kind: "store", name, args });
  const games: typeof activeGameStore = {
    load: (roomId) => activeGameStore.load(roomId),
    claim: (roomId) => activeGameStore.claim(roomId),
    epochOf: (roomId) => activeGameStore.epochOf(roomId),
    listResumable: () => activeGameStore.listResumable(),
    write: async (roomId, state, epoch, adding) => {
      const changed = await activeGameStore.write(roomId, state, epoch, adding);
      landed("write", [roomId]);
      return changed;
    },
    remove: async (roomId, epoch) => {
      const changed = await activeGameStore.remove(roomId, epoch);
      landed("remove", [roomId]);
      return changed;
    },
    countUntouchedSince: (database, cutoff) => activeGameStore.countUntouchedSince(database, cutoff),
    clearPendingResult: (tx, roomId, epoch, round) => activeGameStore.clearPendingResult(tx, roomId, epoch, round),
  };
  const statusFake = options.persist === "real" ? options.writers?.updateRoomStatus : undefined;
  const rooms = statusFake ? { ...roomStore, updateRoomStatus: statusFake } : roomStore;
  const store: TableStore = { games, rooms, ...options.store };

  const record =
    <A extends unknown[], R>(name: string, answer: (...args: A) => R) =>
    (...args: A): R => {
      journal.push({ kind: "write", name, args });
      return answer(...args);
    };
  const production = tableWriters(store);
  const real = options.persist === "real" ? production : null;
  const pick = <K extends keyof TableWriters>(name: K, fake: TableWriters[K]): TableWriters[K] =>
    record(name, (options.writers?.[name] ?? fake) as (...args: unknown[]) => unknown) as TableWriters[K];
  const writers: TableWriters = {
    updateRoomStatus: real
      ? record("updateRoomStatus", real.updateRoomStatus)
      : pick("updateRoomStatus", async () => {}),
    persistGameState: pick("persistGameState", real?.persistGameState ?? (async () => {})),
    discardGame: pick("discardGame", real?.discardGame ?? production.discardGame),
    persistFinalState: pick("persistFinalState", real?.persistFinalState ?? (async () => {})),
    applyPendingResults: pick(
      "applyPendingResults",
      real?.applyPendingResults ??
        (async (_roomId, game) => ({
          applied: game.pendingResults.splice(0).map((entry) => ({ entry, ratings: { ratingDeltas: {}, ratingsAfter: {} } })),
          held: true,
        }))
    ),
  };

  const rt = createTableRuntime({
    out,
    presence,
    writers,
    transport: stubTransport(options.transport),
    peers: lonePeers(options.peers),
    store,
  });

  return {
    rt,
    journal,
    /** What presence answers: `atTable` maps a user to the rooms they joined; `down` answers as a failed cluster. */
    cluster,
    /** The next `game:state` to this account goes unacknowledged once. */
    missAck: (userId: string) => void missed.add(userId),
    sent,
    writes(name: string) {
      return journal.filter((e) => e.kind === "write" && e.name === name);
    },
    events(event: string): unknown[] {
      return sent.filter((e) => e.event === event).map((e) => e.payload);
    },
  };
}
