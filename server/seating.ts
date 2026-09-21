// server/seating.ts — the one way a socket takes a seat. A seated socket is
// never also watching another table: `broadcastGameState` sends a watched
// table's state to the watcher's user room, so it would reach the player's own
// table as traffic from somewhere else.
import type { SocketServer, GameSocket as Socket } from "./socketTypes.ts";
import { socketRoomMap, spectatorRoomMap, userRoom } from "./gameRoom.ts";
import { applyOrForward } from "./tableRouter.ts";

export async function stopSpectating(io: SocketServer, socket: Socket, userId: string): Promise<void> {
  const roomId = spectatorRoomMap.get(socket.id);
  if (!roomId) return;
  spectatorRoomMap.delete(socket.id);
  socket.leave(roomId);
  await applyOrForward(io, { kind: "unspectate", roomId, userId });
}

export async function seatSocket(
  io: SocketServer,
  socket: Socket,
  userId: string,
  roomId: string
): Promise<void> {
  // Left before joining: a watcher sitting down at the table it watched would
  // otherwise leave the room it has just joined.
  const unspectated = stopSpectating(io, socket, userId);
  socket.join(roomId);
  socketRoomMap.set(socket.id, roomId);
  await unspectated;
}

export const STOP_SPECTATING_EVENT = "murlan:stop-spectating";

function stopLocalSpectating(io: SocketServer, userId: string): Promise<unknown> {
  const ids = [...(io.sockets.adapter.rooms.get(userRoom(userId)) ?? [])];
  return Promise.all(
    ids.flatMap((id) => {
      const socket = io.sockets.sockets.get(id);
      return socket ? [stopSpectating(io, socket, userId)] : [];
    })
  );
}

/**
 * For a seat taken while the socket was elsewhere: a match starting deals in
 * players whose sockets may live on any instance, and `spectatorRoomMap` is
 * per instance.
 */
export async function stopSpectatingEverywhere(io: SocketServer, userId: string): Promise<void> {
  io.serverSideEmit(STOP_SPECTATING_EVENT, userId);
  await stopLocalSpectating(io, userId);
}

export function registerStopSpectating(io: SocketServer) {
  io.on(STOP_SPECTATING_EVENT, (userId: string) => void stopLocalSpectating(io, userId));
}
