// server/socket/socketOutbox.ts — the table runtime's presence port over the presence store; its
// output port is `delivery.ts`.
import type { Presence } from "../game/tableRuntime.ts";
import { logger } from "../shared/logger.ts";
import { socketRoomMap, userSocketMap } from "../game/gameRoom.ts";
import { locate as locateInStore, shownOnline as shownInStore, type Located } from "../store/presence.ts";

type Locate = (userIds: readonly string[], opts?: { tables?: boolean }) => Promise<Map<string, Located>>;
type Shown = (userIds: readonly string[]) => Promise<Set<string>>;

/** Answers from this instance's own sockets first: a store that cannot answer must not unseat them. */
export function storePresence(locate: Locate = locateInStore, shown: Shown = shownInStore): Presence {
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
        const here = userIds.filter((id) => userSocketMap.has(id));
        return {
          online: new Set([...where.keys(), ...here]),
          atTable: new Set([
            ...[...where].filter(([, l]) => l.table === roomId).map(([userId]) => userId),
            ...here.filter((id) => socketRoomMap.get(userSocketMap.get(id)!) === roomId),
          ]),
        };
      } catch (err) {
        logger.warn({ err, roomId }, "Presence unreachable");
        return null;
      }
    },

    async onlineAmong(userIds) {
      try {
        const where = await locate(userIds);
        return new Set([...where.keys(), ...userIds.filter((id) => userSocketMap.has(id))]);
      } catch (err) {
        logger.warn({ err }, "Presence unreachable");
        return null;
      }
    },

    async shownAmong(userIds) {
      const here = userIds.filter((id) => userSocketMap.has(id));
      if (here.length === userIds.length) return new Set(here);
      try {
        return new Set([...here, ...(await shown(userIds))]);
      } catch (err) {
        // A friend elsewhere shown offline is the smaller wrong.
        logger.warn({ err }, "Presence did not answer; only this instance's accounts are shown online");
        return new Set(here);
      }
    },
  };
}
