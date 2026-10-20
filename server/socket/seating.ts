// server/socket/seating.ts — the one way a socket takes a seat. A seated socket is
// never also watching another table: `publishState` sends a watched
// table's state to the watcher's user room, so it would reach the player's own
// table as traffic from somewhere else.
import type { GameSocket as Socket } from "./socketTypes.ts";
import type { TableRuntime } from "../game/tableRuntime.ts";
import { socketRoomMap, spectatorRoomMap, userRoom } from "../game/gameRoom.ts";

export async function stopSpectating(rt: TableRuntime, socket: Socket, userId: string): Promise<void> {
  const roomId = spectatorRoomMap.get(socket.id);
  if (!roomId) return;
  spectatorRoomMap.delete(socket.id);
  socket.leave(roomId);
  await rt.route({ kind: "unspectate", roomId, userId });
}

export async function seatSocket(
  rt: TableRuntime,
  socket: Socket,
  userId: string,
  roomId: string
): Promise<void> {
  // Left before joining: a watcher sitting down at the table it watched would
  // otherwise leave the room it has just joined.
  const unspectated = stopSpectating(rt, socket, userId);
  socket.join(roomId);
  socketRoomMap.set(socket.id, roomId);
  await unspectated;
}

const STOP_SPECTATING_EVENT = "murlan:stop-spectating";

function stopLocalSpectating(rt: TableRuntime, userId: string): Promise<unknown> {
  const ids = [...(rt.transport.sockets.adapter.rooms.get(userRoom(userId)) ?? [])];
  return Promise.all(
    ids.flatMap((id) => {
      const socket = rt.transport.sockets.sockets.get(id);
      return socket ? [stopSpectating(rt, socket, userId)] : [];
    })
  );
}

/**
 * For a seat taken while the socket was elsewhere: a match starting deals in
 * players whose sockets may live on any instance, and `spectatorRoomMap` is
 * per instance.
 */
export async function stopSpectatingEverywhere(rt: TableRuntime, userId: string): Promise<void> {
  const peers = new Promise<void>((resolve) => rt.transport.serverSideEmit(STOP_SPECTATING_EVENT, userId, () => resolve()));
  await Promise.all([peers, stopLocalSpectating(rt, userId)]);
}

export function registerStopSpectating(rt: TableRuntime) {
  rt.transport.on(STOP_SPECTATING_EVENT, (userId: string, reply?: () => void) => {
    void stopLocalSpectating(rt, userId).finally(() => reply?.());
  });
}
