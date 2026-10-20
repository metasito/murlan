// server/socket/socketOutbox.ts — the table runtime's output and presence ports
// over Socket.IO.
import type { SocketServer } from "./socketTypes.ts";
import type { Emitter, Presence, TableOutbox } from "../game/tableRuntime.ts";
import { logger } from "../shared/logger.ts";
import { socketRoomMap, userRoom, userSocketMap } from "../game/gameRoom.ts";
import { stateAckTimeoutMs } from "../game/gameTimers.ts";

export function socketOutbox(io: SocketServer): TableOutbox {
  const to = (room: string): Emitter => io.to(room);
  return {
    room: to,
    user: (userId) => to(userRoom(userId)),
    state(userId, render) {
      const send = (retrying: boolean) => {
        const state = render(retrying);
        if (!state) return;
        io.to(userRoom(userId))
          .timeout(stateAckTimeoutMs())
          .emit("game:state", state, (err: unknown) => {
            if (err && !retrying) send(true);
          });
      };
      send(false);
    },
  };
}

/**
 * `adapter.rooms` holds only the sockets this process is serving, so reading it
 * reports a player on another instance as offline. `fetchSockets()` asks the
 * other instances and, when there are none, answers from the local rooms
 * without a round trip. The cluster call rejects if an instance does not answer
 * in time; no caller has anything better to do with that than the answers below.
 */
export function socketPresence(io: SocketServer): Presence {
  return {
    async isOnline(userId) {
      // This instance's own socket needs no cluster to answer, and a failed query must not unseat it.
      if (userSocketMap.has(userId)) return true;
      try {
        return (await io.in(userRoom(userId)).fetchSockets()).length > 0;
      } catch (err) {
        logger.warn({ err, userId }, "Cluster presence check failed; treating as offline");
        return false;
      }
    },

    async isAtTable(userId, roomId) {
      const local = userSocketMap.get(userId);
      if (local && socketRoomMap.get(local) === roomId) return true;
      try {
        return (await io.in(userRoom(userId)).fetchSockets()).some((s) => s.rooms.has(roomId));
      } catch (err) {
        logger.warn({ err, userId, roomId }, "Cluster presence check failed; treating as away");
        return false;
      }
    },

    async tablePresence(roomId) {
      const online = new Set<string>();
      const atTable = new Set<string>();
      try {
        for (const s of await io.fetchSockets()) {
          const userId: unknown = s.data?.userId;
          if (typeof userId !== "string") continue;
          online.add(userId);
          if (s.rooms.has(roomId)) atTable.add(userId);
        }
      } catch (err) {
        logger.warn({ err, roomId }, "Cluster presence sweep failed");
        return null;
      }
      return { online, atTable };
    },

    async connectedUserIds() {
      try {
        return new Set(
          (await io.fetchSockets())
            .map((s) => s.data?.userId)
            .filter((id): id is string => typeof id === "string")
        );
      } catch (err) {
        logger.warn({ err }, "Cluster presence sweep failed");
        return null;
      }
    },
  };
}
