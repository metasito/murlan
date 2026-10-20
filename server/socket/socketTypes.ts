import type { Server, Socket } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "../../shared/protocol.ts";
import type { TableRuntime } from "../game/tableRuntime.ts";

export type SocketServer = Server<ClientToServerEvents, ServerToClientEvents>;
export type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

/** What every per-socket handler family is registered with. */
export interface HandlerContext {
  io: SocketServer;
  rt: TableRuntime;
  socket: GameSocket;
  userId: string;
}
