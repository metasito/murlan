// server/socket/peers.ts — the other instances as the table runtime reaches them.
import type { Peers } from "../game/tableRuntime.ts";
import { onInstanceMessage, sendToInstance } from "../store/instanceInbox.ts";
import { instanceId } from "../store/redis.ts";
import { tableOwnerOf } from "../store/tableOwners.ts";
import { instancesOf } from "../store/presence.ts";
import { heardFrom, stillSubscribed } from "./socketAdapter.ts";

export function instancePeers(): Peers {
  return {
    self: instanceId,
    send: sendToInstance,
    on: onInstanceMessage,
    ownerOf: tableOwnerOf,
    instanceOf: async (userId) => (await instancesOf([userId])).get(userId) ?? null,
    heard: heardFrom,
    stillSubscribed,
  };
}
