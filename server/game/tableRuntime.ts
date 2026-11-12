// server/game/tableRuntime.ts — everything a table reaches outside itself, built
// once by `setupSocket`. The game layer names no Socket.IO type but `transport`
// here (`tests/server/tableRuntimeScan.test.ts`).
import type { SocketServer } from "../socket/socketTypes.ts";
import type { ServerToClientEvents, OrderedGameState } from "../../shared/protocol.ts";
import type { activeGameStore, TableRoomPort } from "../store/activeGameStore.ts";
import type { Outcome } from "../shared/refusal.ts";
import type { TableActionDraft } from "./tableActions.ts";
import type { RoundOverWriters } from "./roundOver.ts";
import type { InstanceHandler, InstanceMessage } from "../store/instanceInbox.ts";
import { applyOrForward, registerTableRouting } from "./tableRouter.ts";
import { reopenOwnership } from "./gameOwnership.ts";
import { disposeGame, stopTables } from "./gamePersistence.ts";
import { expireVoteDeadline } from "./tableVotes.ts";
import { handOffTables, registerHandOff } from "./tableHandOff.ts";

type OutEvent = Exclude<keyof ServerToClientEvents, "game:state">;

export interface Emitter {
  emit<E extends OutEvent>(event: E, ...args: Parameters<ServerToClientEvents[E]>): void;
}

/** Never throws; a send to a room nobody is in is a no-op. */
export interface TableOutbox {
  /** The table's seats and spectators while this instance holds its game, else the room's seats. */
  room(roomId: string): Emitter;
  /** The account, wherever it is connected. */
  user(userId: string): Emitter;
  /**
   * `game:state` to one account. If the ack does not come, `render(true)` is
   * called once more and its result sent; `null` sends nothing. A newer state
   * for the same table replaces one still waiting to go.
   */
  state(userId: string, render: (retrying: boolean) => OrderedGameState | null): void;
}

/** Where accounts are connected, asked of the presence store; none throws. */
export interface Presence {
  /** False when the store fails, unless the account is connected to this instance. */
  isOnline(userId: string): Promise<boolean>;
  /** False when the store fails, unless the account is seated there through this instance. */
  isAtTable(userId: string, roomId: string): Promise<boolean>;
  /** Of `userIds`, who is connected and who is seated at `roomId`. Null when the store did not answer. */
  tablePresence(roomId: string, userIds: readonly string[]): Promise<{ online: Set<string>; atTable: Set<string> } | null>;
  /** Of `userIds`, who is connected. Null when the store did not answer — never read as "nobody": the sweep disposes on it. */
  onlineAmong(userIds: readonly string[]): Promise<Set<string> | null>;
  /**
   * Of `userIds`, those their friends are shown as online: these, and those whose instance left
   * and whose offline notice a sweep has yet to send. Only this instance's own when the store fails.
   */
  shownAmong(userIds: readonly string[]): Promise<Set<string>>;
}

/** The other instances, one address at a time (`server/store/instanceInbox.ts`). */
export interface Peers {
  self: string;
  /**
   * Rejects at once while the store is down. Resolves for an instance that is gone: its inbox
   * takes the message and nobody reads it.
   */
  send(to: string, message: InstanceMessage): Promise<void>;
  /** `send` to an instance whose inbox is still kept; false for one that is gone. Rejects while the store is down. */
  offer(to: string, message: InstanceMessage): Promise<boolean>;
  /** The other instances alive now; rejects when that cannot be read. */
  live(): Promise<string[]>;
  /** A handler that awaits holds up every later message to this instance. */
  on(kind: string, handler: InstanceHandler): void;
  /** The instance a table's owner record names, null with none; rejects when it cannot be read. */
  ownerOf(roomId: string): Promise<string | null>;
  /** The instance an account's presence entry names, null while offline; rejects when it cannot be read. */
  instanceOf(userId: string): Promise<string | null>;
  /** Whether that instance's heartbeat was heard within the grace. */
  heard(instance: string): boolean;
  /** Whether that instance is connected to the cluster now; rejects when that cannot be read. */
  stillSubscribed(instance: string): Promise<boolean>;
}

/** The only path a table's row and room-status writes take (`gamePersistence.ts` `tableWriters`). */
export interface TableWriters extends RoundOverWriters {
  /** Deletes the room's `active_games` row after every earlier write to it. Never rejects. */
  discardGame(roomId: string): Promise<unknown>;
}

/** The stores whole, as the writers are built over them. */
export interface TableStore {
  games: typeof activeGameStore;
  rooms: TableRoomPort;
}

/** What a table reads, and the seat rows it keeps; every other write is `writers`'. */
export interface TableReads {
  games: Pick<typeof activeGameStore, "listResumable">;
  rooms: Omit<TableRoomPort, "updateRoomStatus">;
}

export interface TablePorts {
  out: TableOutbox;
  presence: Presence;
  writers: TableWriters;
  /** Socket.IO itself, for `socket/seating.ts` alone. */
  transport: SocketServer;
  peers: Peers;
  store: TableStore;
}

export interface TableRuntime extends Omit<TablePorts, "store"> {
  store: TableReads;
  /** Runs a table action wherever the table is. */
  route(draft: TableActionDraft): Promise<Outcome>;
  /** See `tableHandOff.ts`; the shutdown's first table step. */
  handOffTables(budgetMs: number): Promise<void>;
  /** See `gamePersistence.ts` `stopTables`; the shutdown's last table step. */
  stopTables(): Promise<void>;
  /** What the next-round vote deadline does when it runs out. */
  expireVoteDeadline(roomId: string): Promise<void>;
}

/**
 * Registers the routing listener on `peers`, so it must run before the first
 * connection: a forwarded action that lands earlier is answered by nobody.
 */
export function createTableRuntime(ports: TablePorts): TableRuntime {
  const rt: TableRuntime = {
    ...ports,
    route: (draft) => applyOrForward(rt, draft),
    handOffTables: (budgetMs) => handOffTables(rt, budgetMs),
    stopTables,
    expireVoteDeadline: (roomId) => expireVoteDeadline(rt, roomId),
  };
  registerTableRouting(rt);
  registerHandOff(rt);
  reopenOwnership({ onRoomLost: (roomId) => disposeGame(rt, roomId, false), rows: ports.store.games });
  return rt;
}
