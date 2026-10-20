// server/game/tableRuntime.ts — everything a table reaches outside itself, built
// once by `setupSocket`. The game layer names no Socket.IO type but `transport`
// here (`tests/server/tableRuntimeScan.test.ts`).
import type { SocketServer } from "../socket/socketTypes.ts";
import type { ServerToClientEvents, WireGameState } from "../../shared/protocol.ts";
import type { activeGameStore, TableRoomPort } from "../store/activeGameStore.ts";
import type { Outcome } from "../shared/refusal.ts";
import type { TableActionDraft } from "./tableActions.ts";
import type { RoundOverWriters } from "./roundOver.ts";
import { applyOrForward, registerTableRouting } from "./tableRouter.ts";
import { reopenOwnership } from "./gameOwnership.ts";
import { disposeGame, stopTables } from "./gamePersistence.ts";
import { expireVoteDeadline } from "./tableHandlers.ts";

type OutEvent = Exclude<keyof ServerToClientEvents, "game:state">;

export interface Emitter {
  emit<E extends OutEvent>(event: E, ...args: Parameters<ServerToClientEvents[E]>): void;
}

/** Never throws; a send to a room nobody is in is a no-op. */
export interface TableOutbox {
  /** Everyone in the Socket.IO room, on every instance. */
  room(roomId: string): Emitter;
  /** The account's user room, never a socket. */
  user(userId: string): Emitter;
  /**
   * `game:state` to one account. If the ack does not come, `render(true)` is
   * called once more and its result sent; `null` sends nothing.
   */
  state(userId: string, render: (retrying: boolean) => WireGameState | null): void;
}

/** All asked of the cluster; none throws. */
export interface Presence {
  /** False when the cluster fails. */
  isOnline(userId: string): Promise<boolean>;
  /** False when the cluster fails. */
  isAtTable(userId: string, roomId: string): Promise<boolean>;
  tablePresence(roomId: string): Promise<{ online: Set<string>; atTable: Set<string> } | null>;
  /** Null when the cluster did not answer — never read as "nobody": the sweep disposes on it. */
  connectedUserIds(): Promise<Set<string> | null>;
}

/** The only path a table's database writes take. */
export type TableWriters = RoundOverWriters;

export interface TableStore {
  games: typeof activeGameStore;
  rooms: TableRoomPort;
}

export interface TablePorts {
  out: TableOutbox;
  presence: Presence;
  writers: TableWriters;
  /** Socket.IO itself, for the router and `socket/seating.ts` alone. */
  transport: SocketServer;
  store: TableStore;
}

export interface TableRuntime extends TablePorts {
  /** Runs a table action wherever the table is. */
  route(draft: TableActionDraft): Promise<Outcome>;
  /** See `gamePersistence.ts` `stopTables`; the shutdown's one table step. */
  stopTables(): Promise<void>;
  /** What the next-round vote deadline does when it runs out. */
  expireVoteDeadline(roomId: string): Promise<void>;
}

/**
 * Registers the routing listener on `transport`, so it must run before the
 * first connection: a forwarded action that lands earlier is answered by nobody.
 */
export function createTableRuntime(ports: TablePorts): TableRuntime {
  const rt: TableRuntime = {
    ...ports,
    route: (draft) => applyOrForward(rt, draft),
    stopTables,
    expireVoteDeadline: (roomId) => expireVoteDeadline(rt, roomId),
  };
  registerTableRouting(rt);
  reopenOwnership({ onRoomLost: (roomId) => disposeGame(rt, roomId, false) });
  return rt;
}
