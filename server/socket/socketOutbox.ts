// server/socket/socketOutbox.ts — the table runtime's presence port over the presence store; its
// output port is `delivery.ts`.
import type { Presence } from "../game/tableRuntime.ts";
import { logger } from "../shared/logger.ts";
import { socketRoomMap, userSocketMap } from "../game/gameRoom.ts";
import { locate as locateInStore, type Located } from "../store/presence.ts";

type Locate = (userIds: readonly string[], opts?: { tables?: boolean }) => Promise<Map<string, Located>>;

/** Answers from this instance's own sockets first: a store that cannot answer must not unseat them. */
export function storePresence(locate: Locate = locateInStore): Presence {
  return {
    async isOnline(userId) {
      if (userSocketMap.has(userId)) return true;
      try {
        return (await locate([userId])).has(userId);
      } catch (err) {
        logger.warn({ err, userId }, "Presence unreachable; treating as offline");
        return false;
      }
    },

    async isAtTable(userId, roomId) {
      const local = userSocketMap.get(userId);
      if (local && socketRoomMap.get(local) === roomId) return true;
      try {
        return (await locate([userId], { tables: true })).get(userId)?.table === roomId;
      } catch (err) {
        logger.warn({ err, userId, roomId }, "Presence unreachable; treating as away");
        return false;
      }
    },

    async tablePresence(roomId, userIds) {
      try {
        const where = await locate(userIds, { tables: true });
        return {
          online: new Set(where.keys()),
          atTable: new Set([...where].filter(([, l]) => l.table === roomId).map(([userId]) => userId)),
        };
      } catch (err) {
        logger.warn({ err, roomId }, "Presence unreachable");
        return null;
      }
    },

    async onlineAmong(userIds) {
      try {
        return new Set((await locate(userIds)).keys());
      } catch (err) {
        logger.warn({ err }, "Presence unreachable");
        return null;
      }
    },
  };
}
