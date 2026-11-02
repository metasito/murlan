// server/socket/seating.ts — the one way a socket takes a seat. A seated socket is
// never also watching another table: `publishState` sends a watched
// table's state to the watcher's user room, so it would reach the player's own
// table as traffic from somewhere else.
import type { GameSocket as Socket } from "./socketTypes.ts";
import type { TableRuntime } from "../game/tableRuntime.ts";
import { socketRoomMap, spectatorRoomMap, userRoom } from "../game/gameRoom.ts";
import { logger } from "../shared/logger.ts";

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

const STOP_SPECTATING = "stop-spectating";
/** What a revision before inbox routing emits and answers (ADR 0014, decision 9). */
const LEGACY_STOP_SPECTATING = "murlan:stop-spectating";
/** As long as a forwarded table action's try (`server/game/tableRouter.ts`). */
const TELL_WITHIN_MS = 1_500;

function stopLocalSpectating(rt: TableRuntime, userId: string): Promise<unknown> {
  const ids = [...(rt.transport.sockets.adapter.rooms.get(userRoom(userId)) ?? [])];
  return Promise.all(
    ids.flatMap((id) => {
      const socket = rt.transport.sockets.sockets.get(id);
      return socket ? [stopSpectating(rt, socket, userId)] : [];
    })
  );
}

async function tellTheirInstance(rt: TableRuntime, userId: string): Promise<void> {
  const at = await rt.peers.instanceOf(userId);
  if (!at || at === rt.peers.self) return;
  if (rt.peers.speaksInbox(at)) await rt.peers.send(at, { kind: STOP_SPECTATING, userId });
  else await rt.peers.legacy.ask(LEGACY_STOP_SPECTATING, userId);
}

/**
 * For a seat taken while the socket was elsewhere: a match starting deals in
 * players whose sockets may live on any instance, and `spectatorRoomMap` is
 * per instance.
 *
 * Resolves once the message is in the instance's inbox, not once it is acted on: that inbox is
 * read in order, so it is acted on before any state of the table this seat was taken at.
 */
export async function stopSpectatingEverywhere(rt: TableRuntime, userId: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const told = tellTheirInstance(rt, userId).catch((err: unknown) =>
    logger.warn({ err, userId }, "Could not tell an account's instance it stopped watching")
  );
  const late = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, TELL_WITHIN_MS);
  });
  try {
    await Promise.all([Promise.race([told, late]), stopLocalSpectating(rt, userId)]);
  } finally {
    clearTimeout(timer);
  }
}

export function registerStopSpectating(rt: TableRuntime) {
  rt.peers.legacy.answer(LEGACY_STOP_SPECTATING, async (userId) => {
    if (typeof userId === "string") await stopLocalSpectating(rt, userId);
  });
  rt.peers.on(STOP_SPECTATING, ({ userId }) => {
    if (typeof userId !== "string") return;
    void stopLocalSpectating(rt, userId).catch((err: unknown) =>
      logger.warn({ err, userId }, "Could not stop an account watching")
    );
  });
}
