// server/socket/peers.ts — the other instances as the table runtime reaches them: each one's
// inbox, and Socket.IO's emit for a revision that predates it (ADR 0014, decision 9).
import type { SocketServer } from "./socketTypes.ts";
import type { Peers } from "../game/tableRuntime.ts";
import { logger } from "../shared/logger.ts";
import { onInstanceMessage, sendToInstance } from "../store/instanceInbox.ts";
import { instanceId } from "../store/redis.ts";
import { tableOwnerOf } from "../store/tableOwners.ts";
import { instancesOf } from "../store/presence.ts";
import { speaksInbox, stillSubscribed } from "./socketAdapter.ts";

export function instancePeers(io: SocketServer): Peers {
  return {
    self: instanceId,
    send: sendToInstance,
    on: onInstanceMessage,
    ownerOf: tableOwnerOf,
    instanceOf: async (userId) => (await instancesOf([userId])).get(userId) ?? null,
    speaksInbox,
    stillSubscribed,
    legacy: {
      ask: (event, payload) =>
        new Promise((resolve) => {
          io.serverSideEmit(event, payload, (err: unknown, replies: unknown[] = []) => resolve({ err, replies }));
        }),
      answer(event, handler) {
        io.on(event, (payload: unknown, reply?: (answer: unknown) => void) => {
          if (typeof reply !== "function") return;
          void handler(payload).then(reply, (err: unknown) => {
            logger.error({ err, event }, "An older instance's request threw");
            reply({ ok: false, code: "SERVER_ERROR" });
          });
        });
      },
    },
  };
}
