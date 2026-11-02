// A table runtime that records what it was asked to do, for unit tests: every
// send with its address, every writer call, and presence a test sets by hand.
import type { SocketServer } from "../../server/socket/socketTypes.ts";
import type { Emitter, Presence, TableOutbox, TableStore, TableWriters } from "../../server/game/tableRuntime.ts";
import { createTableRuntime } from "../../server/game/tableRuntime.ts";
import { activeGameStore } from "../../server/store/activeGameStore.ts";
import { roomStore } from "../../server/store/roomStore.ts";
import { tableWriters } from "../../server/game/gamePersistence.ts";

export type Address = { room: string } | { user: string };
/** `payload` is `args[0]`, the one argument every event but `game:state`'s ack carries. */
export type SentEntry = { kind: "send"; to: Address; event: string; args: unknown[]; payload: unknown };
export type JournalEntry =
  | SentEntry
  | { kind: "write"; name: string; args: unknown[] }
  | { kind: "store"; name: string; args: unknown[] };

/**
 * Socket.IO as a single instance with nobody connected: every cluster question
 * answers empty, every forward is answered by nobody. The repo's one cast to
 * `SocketServer`; `overrides` replace whole members.
 */
export function stubTransport(overrides: Record<string, unknown> = {}): SocketServer {
  return {
    to: () => ({ emit: () => true, timeout: () => ({ emit: () => true }) }),
    in: () => ({ fetchSockets: async () => [] }),
    fetchSockets: async () => [],
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

export interface RecordingOptions {
  writers?: Partial<TableWriters>;
  presence?: Partial<Presence>;
  transport?: Record<string, unknown>;
  store?: Partial<TableStore>;
  /**
   * "real" runs the production row and status writers (`tableWriters`) over
   * the store, so its ordering is under test; the stats writers stay fakes. A
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
    tablePresence: async (roomId) =>
      cluster.down
        ? null
        : {
            online: new Set(cluster.online),
            atTable: new Set([...cluster.atTable].filter(([, rooms]) => rooms.has(roomId)).map(([u]) => u)),
          },
    connectedUserIds: async () => (cluster.down ? null : new Set(cluster.online)),
    ...options.presence,
  };

  // Journalled when the underlying store settles: the order rows land in, not the order they were asked for.
  const landed = (name: string, args: unknown[]) => journal.push({ kind: "store", name, args });
  const games: typeof activeGameStore = {
    load: (roomId) => activeGameStore.load(roomId),
    claim: (roomId) => activeGameStore.claim(roomId),
    epochOf: (roomId) => activeGameStore.epochOf(roomId),
    listResumable: () => activeGameStore.listResumable(),
    write: async (roomId, state, epoch) => {
      const changed = await activeGameStore.write(roomId, state, epoch);
      landed("write", [roomId]);
      return changed;
    },
    remove: async (roomId, epoch) => {
      const changed = await activeGameStore.remove(roomId, epoch);
      landed("remove", [roomId]);
      return changed;
    },
    countUntouchedSince: (database, cutoff) => activeGameStore.countUntouchedSince(database, cutoff),
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
    recordGameResult: pick("recordGameResult", async () => {}),
    recordRatedResult: pick("recordRatedResult", async () => new Map()),
    previewRatedDeltas: pick("previewRatedDeltas", async () => new Map()),
    saveReplay: pick("saveReplay", async () => {}),
  };

  const rt = createTableRuntime({
    out,
    presence,
    writers,
    transport: stubTransport(options.transport),
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
