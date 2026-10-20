// A table runtime that records what it was asked to do, for unit tests: every
// send with its address, every writer call, and presence a test sets by hand.
import type { SocketServer } from "../../server/socket/socketTypes.ts";
import type { Emitter, Presence, TableOutbox, TableStore, TableWriters } from "../../server/game/tableRuntime.ts";
import { createTableRuntime } from "../../server/game/tableRuntime.ts";
import { activeGameStore } from "../../server/store/activeGameStore.ts";
import { roomStore } from "../../server/store/roomStore.ts";

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

  const record =
    <A extends unknown[], R>(name: string, answer: (...args: A) => R) =>
    (...args: A): R => {
      journal.push({ kind: "write", name, args });
      return answer(...args);
    };
  const writers: TableWriters = {
    updateRoomStatus: record("updateRoomStatus", options.writers?.updateRoomStatus ?? (async () => {})),
    persistGameState: record("persistGameState", options.writers?.persistGameState ?? (async () => {})),
    recordGameResult: record("recordGameResult", options.writers?.recordGameResult ?? (async () => {})),
    recordRatedResult: record("recordRatedResult", options.writers?.recordRatedResult ?? (async () => new Map())),
    previewRatedDeltas: record("previewRatedDeltas", options.writers?.previewRatedDeltas ?? (async () => new Map())),
    saveReplay: record("saveReplay", options.writers?.saveReplay ?? (async () => {})),
  };

  const games: typeof activeGameStore = {
    load: (roomId) => activeGameStore.load(roomId),
    list: () => activeGameStore.list(),
    write: (roomId, state) => activeGameStore.write(roomId, state),
    remove: (roomId) => {
      journal.push({ kind: "store", name: "remove", args: [roomId] });
      return activeGameStore.remove(roomId);
    },
    countUntouchedSince: (cutoff) => activeGameStore.countUntouchedSince(cutoff),
  };

  const rt = createTableRuntime({
    out,
    presence,
    writers,
    transport: stubTransport(options.transport),
    store: { games, rooms: roomStore, ...options.store },
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
