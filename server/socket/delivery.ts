// server/socket/delivery.ts — the one module that decides who a message reaches and how: a
// recipient on this instance directly, every other one through the inbox of the instance their
// presence entry names (ADR 0014, decisions 6 and 7).
import type { ForwardingServer, GameSocket, SocketServer } from "./socketTypes.ts";
import type { Emitter, TableOutbox } from "../game/tableRuntime.ts";
import type { OrderedGameState } from "../../shared/protocol.ts";
import { logger } from "../shared/logger.ts";
import { stateAcksMissed } from "../shared/metrics.ts";
import { heldAudience, userRoom } from "../game/gameRoom.ts";
import { stateAckTimeoutMs } from "../game/gameTimers.ts";
import { instanceId } from "../store/redis.ts";
import { onInstanceMessage, sendToInstance, type InstanceHandler, type InstanceMessage } from "../store/instanceInbox.ts";
import { instancesOf } from "../store/presence.ts";
import { roomStore } from "../store/roomStore.ts";

const DELIVER = "deliver";
const STATE_NACK = "state-nack";
/** How long an owner can still answer a nack for a state it sent another instance. */
const NACK_WINDOW_ACKS = 4;

type Item =
  | { t: "emit"; u: string[]; e: string; a: unknown[] }
  | { t: "state"; u: string; s: OrderedGameState; r: boolean };

interface Pending {
  state: OrderedGameState;
  retry: boolean;
  missed: () => void;
}

export interface DeliveryOptions {
  self?: string;
  locate?: (userIds: readonly string[]) => Promise<Map<string, string>>;
  send?: (to: string, message: InstanceMessage) => Promise<void>;
  on?: (kind: string, handler: InstanceHandler) => void;
  seatsOf?: (roomId: string) => Promise<string[]>;
}

const seatedIn = async (roomId: string) => (await roomStore.getRoomPlayers(roomId)).map((p) => p.userId);


export function deliveryOutbox(io: SocketServer, options: DeliveryOptions = {}): TableOutbox {
  const self = options.self ?? instanceId;
  const locate = options.locate ?? instancesOf;
  const send = options.send ?? sendToInstance;
  const on = options.on ?? onInstanceMessage;
  const seatsOf = options.seatsOf ?? seatedIn;
  const rooms = io.sockets.adapter.rooms;

  const socketsOf = (userId: string): GameSocket[] =>
    [...(rooms.get(userRoom(userId)) ?? [])].flatMap((id) => io.sockets.sockets.get(id) ?? []);
  const isLocal = (userId: string) => (rooms.get(userRoom(userId))?.size ?? 0) > 0;
  /** This instance's sockets in the Socket.IO room: what a room emit reached before addressing. */
  const membersHere = (roomId: string) =>
    [...(rooms.get(roomId) ?? [])].flatMap((id) => {
      const userId: unknown = io.sockets.sockets.get(id)?.data?.userId;
      return typeof userId === "string" ? [userId] : [];
    });

  // ── At most one state outstanding per recipient and table, and one queued behind it ──
  const slots = new Map<string, { queued: Pending | null }>();

  function offer(userId: string, pending: Pending): void {
    const key = `${userId}\n${pending.state.roomId}`;
    const slot = slots.get(key);
    if (slot) {
      slot.queued = pending;
      return;
    }
    const fresh = { queued: null };
    slots.set(key, fresh);
    emitState(userId, key, fresh, pending);
  }

  function emitState(userId: string, key: string, slot: { queued: Pending | null }, pending: Pending): void {
    const sockets = socketsOf(userId);
    if (sockets.length === 0) {
      slots.delete(key);
      return;
    }
    let waiting = sockets.length;
    let acked = false;
    const settle = () => {
      if (!acked) stateAcksMissed.inc();
      const next = slot.queued;
      slot.queued = null;
      if (next) return emitState(userId, key, slot, next);
      slots.delete(key);
      if (!acked && !pending.retry) pending.missed();
    };
    for (const socket of sockets) {
      socket.timeout(stateAckTimeoutMs()).emit("game:state", pending.state, (err: unknown) => {
        if (!err) acked = true;
        if (--waiting === 0) settle();
      });
    }
  }

  // ── Everything for other instances leaves in one message per instance per tick, in call order ──
  let batch: Item[] = [];
  let tail: Promise<void> = Promise.resolve();

  function enqueue(item: Item): void {
    if (batch.length === 0) queueMicrotask(flush);
    batch.push(item);
  }

  function flush(): void {
    const items = batch;
    batch = [];
    const users = [...new Set(items.flatMap((item) => (item.t === "emit" ? item.u : [item.u])))];
    const located = locate(users).catch((err: unknown) => {
      logger.warn({ err }, "Presence unreachable: messages for other instances dropped");
      return null;
    });
    tail = tail.then(async () => {
      const where = await located;
      if (!where) return;
      const elsewhere = (userId: string) => {
        const at = where.get(userId);
        return at !== undefined && at !== self ? at : undefined;
      };
      const per = new Map<string, Item[]>();
      const add = (to: string, item: Item) => {
        const list = per.get(to);
        if (list) list.push(item);
        else per.set(to, [item]);
      };
      for (const item of items) {
        if (item.t === "state") {
          const to = elsewhere(item.u);
          if (to) add(to, item);
          continue;
        }
        const byInstance = new Map<string, string[]>();
        for (const userId of item.u) {
          const to = elsewhere(userId);
          if (to) byInstance.set(to, [...(byInstance.get(to) ?? []), userId]);
        }
        for (const [to, u] of byInstance) add(to, { ...item, u });
      }
      for (const [instance, list] of per) {
        void send(instance, { kind: DELIVER, from: self, items: list }).catch((err: unknown) =>
          logger.warn({ err, instance }, "Could not hand messages to another instance")
        );
      }
    });
  }

  function emitTo(userIds: Iterable<string>, event: string, args: unknown[]): void {
    const here: string[] = [];
    const elsewhere: string[] = [];
    for (const userId of new Set(userIds)) (isLocal(userId) ? here : elsewhere).push(userId);
    if (here.length > 0) emitHere(here, event, args);
    if (elsewhere.length > 0) enqueue({ t: "emit", u: elsewhere, e: event, a: args });
  }

  const forwarding = io as unknown as ForwardingServer;
  const emitHere = (userIds: string[], event: string, args: unknown[]) =>
    forwarding.local.to(userIds.map(userRoom)).emit(event, ...args);

  // ── A state another instance could not get acknowledged is re-derived here, never re-sent ──
  const renders = new Map<string, { render: (retrying: boolean) => OrderedGameState | null; timer: ReturnType<typeof setTimeout> }>();

  function remember(userId: string, roomId: string, render: (retrying: boolean) => OrderedGameState | null): void {
    const key = `${userId}\n${roomId}`;
    const previous = renders.get(key);
    if (previous) clearTimeout(previous.timer);
    const timer = setTimeout(() => {
      if (renders.get(key)?.timer === timer) renders.delete(key);
    }, NACK_WINDOW_ACKS * stateAckTimeoutMs());
    (timer as unknown as { unref?: () => void }).unref?.();
    renders.set(key, { render, timer });
  }

  function sendState(userId: string, state: OrderedGameState, retry: boolean, render: (retrying: boolean) => OrderedGameState | null): void {
    if (isLocal(userId)) {
      offer(userId, {
        state,
        retry,
        missed: () => {
          const again = render(true);
          if (again) sendState(userId, again, true, render);
        },
      });
      return;
    }
    if (!retry) remember(userId, state.roomId, render);
    enqueue({ t: "state", u: userId, s: state, r: retry });
  }

  on(STATE_NACK, ({ roomId, userId }) => {
    if (typeof roomId !== "string" || typeof userId !== "string") return;
    const key = `${userId}\n${roomId}`;
    const held = renders.get(key);
    if (!held) return;
    clearTimeout(held.timer);
    renders.delete(key);
    const again = held.render(true);
    if (again) sendState(userId, again, true, held.render);
  });

  on(DELIVER, ({ from, items }) => {
    if (typeof from !== "string" || !Array.isArray(items)) return;
    for (const item of items as Item[]) {
      if (item.t === "emit") {
        const here = item.u.filter(isLocal);
        if (here.length > 0) emitHere(here, item.e, item.a);
        continue;
      }
      const { u: userId, s: state } = item;
      offer(userId, {
        state,
        retry: item.r,
        missed: () =>
          void send(from, { kind: STATE_NACK, roomId: state.roomId, userId }).catch((err: unknown) =>
            logger.warn({ err, roomId: state.roomId, userId }, "Could not tell a table's owner a state went unacknowledged")
          ),
      });
    }
  });

  // ── A room's emits leave in the order they were made, whichever had to read its seats ──
  const roomTails = new Map<string, Promise<void>>();

  function emitToRoom(roomId: string, event: string, args: unknown[]): void {
    const held = heldAudience(roomId);
    const behind = roomTails.get(roomId);
    if (held && !behind) return emitTo([...held, ...membersHere(roomId)], event, args);
    const audience = held
      ? Promise.resolve(held)
      : seatsOf(roomId).catch((err: unknown) => {
          logger.warn({ err, roomId }, "Could not read a room's seats: its emit reaches this instance's members only");
          return [];
        });
    const sent: Promise<void> = (behind ?? Promise.resolve())
      .then(() => audience)
      .then((users) => emitTo([...users, ...membersHere(roomId)], event, args));
    roomTails.set(roomId, sent);
    void sent.finally(() => {
      if (roomTails.get(roomId) === sent) roomTails.delete(roomId);
    });
  }

  const emitter = (deliver: (event: string, args: unknown[]) => void): Emitter => ({
    emit: (event, ...args) => deliver(event, args),
  });

  return {
    room: (roomId) => emitter((event, args) => emitToRoom(roomId, event, args)),
    user: (userId) => emitter((event, args) => emitTo([userId], event, args)),
    state(userId, render) {
      const state = render(false);
      if (state) sendState(userId, state, false, render);
    },
  };
}
