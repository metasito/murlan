// Map-backed twins of `activeGameStore` and the `TableRoomPort` methods, so a
// table test needs neither Postgres nor a mock of drizzle's internals.
import type { TestContext } from "node:test";
import { activeGameStore, type OwnerFence, type TableRoomPort } from "../../server/store/activeGameStore.ts";
import { roomStore } from "../../server/store/roomStore.ts";
import { renumbering, settleRelease, startRefusal } from "../../server/game/seatAllocation.ts";
import type { Room } from "../../shared/schema.ts";

type Seat = Awaited<ReturnType<TableRoomPort["getRoomPlayers"]>>[number];

export interface MemoryTableStores {
  rooms: Map<string, Room>;
  seats: Map<string, Seat[]>;
  rows: Map<string, unknown>;
  /** Each row's `owner_epoch`; a seeded row starts at 0, as one written before epochs did. */
  epochs: Map<string, number>;
}

export interface MemoryTableSeed {
  rooms?: Iterable<[string, Partial<Room>]>;
  seats?: Iterable<[string, Partial<Seat>[]]>;
  rows?: Iterable<[string, unknown]>;
}

export function useMemoryTableStores(t: TestContext, seed: MemoryTableSeed = {}): MemoryTableStores {
  const rooms = new Map([...(seed.rooms ?? [])].map(([id, room]) => [id, { id, ...room } as Room]));
  const seats = new Map([...(seed.seats ?? [])].map(([id, list]) => [id, list as Seat[]]));
  const rows = new Map(seed.rows ?? []);
  const seated = (roomId: string) => [...(seats.get(roomId) ?? [])].sort((a, b) => a.seatIndex - b.seatIndex);

  const epochs = new Map<string, number>([...rows.keys()].map((roomId) => [roomId, 0]));
  const at = (roomId: string, epoch: number) => rows.has(roomId) && epochs.get(roomId) === epoch;
  t.mock.method(activeGameStore, "load", async (roomId: string) =>
    rows.has(roomId) ? { roomId, gameState: rows.get(roomId) } : undefined
  );
  t.mock.method(activeGameStore, "claim", async (roomId: string) => {
    if (!rows.has(roomId)) return undefined;
    const ownerEpoch = (epochs.get(roomId) ?? 0) + 1;
    epochs.set(roomId, ownerEpoch);
    return { roomId, gameState: rows.get(roomId), ownerEpoch };
  });
  t.mock.method(activeGameStore, "epochOf", async (roomId: string) => (rows.has(roomId) ? epochs.get(roomId) : undefined));
  t.mock.method(activeGameStore, "list", async () =>
    [...rows].map(([roomId, gameState]) => ({ roomId, gameState }))
  );
  t.mock.method(activeGameStore, "write", async (roomId: string, gameState: unknown, fence: OwnerFence) => {
    if (fence.rowExists ? !at(roomId, fence.epoch) : rows.has(roomId) && !at(roomId, fence.epoch)) return false;
    rows.set(roomId, gameState);
    epochs.set(roomId, fence.epoch);
    return true;
  });
  t.mock.method(activeGameStore, "remove", async (roomId: string, epoch: number) => {
    if (!at(roomId, epoch)) return false;
    rows.delete(roomId);
    epochs.delete(roomId);
    return true;
  });

  const port: TableRoomPort = {
    getRoomById: async (id) => rooms.get(id) as Room,
    getRoomPlayers: async (roomId) => seated(roomId),
    updateRoomStatus: async (roomId, status) => {
      const room = rooms.get(roomId);
      if (room) rooms.set(roomId, { ...room, status });
    },
    restoreSeat: async (roomId, userId, seatIndex, host) => {
      const room = rooms.get(roomId);
      if (!room) return;
      const others = seated(roomId).filter((s) => s.userId !== userId);
      seats.set(roomId, [...others, { roomId, userId, seatIndex, user: { id: userId } } as Seat]);
      if (host) rooms.set(roomId, { ...room, hostUserId: userId });
    },
    upsertRoomPlayer: async (roomId, userId, seatIndex) => {
      const others = seated(roomId).filter((s) => s.userId !== userId);
      const seat = { roomId, userId, seatIndex, user: { id: userId } } as Seat;
      seats.set(roomId, [...others, seat]);
    },
    releaseSeat: async (roomId, userId) => {
      const room = rooms.get(roomId);
      if (!room) return null;
      const remaining = seated(roomId).filter((s) => s.userId !== userId);
      seats.set(roomId, remaining);
      const { emptied, wasHost, set } = settleRelease(room, userId, remaining);
      const updated: Room = { ...room, ...set };
      rooms.set(roomId, updated);
      return { room: updated, remaining, emptied, wasHost };
    },
    closeForStart: async (roomId, userId, opts) => {
      const room = rooms.get(roomId);
      if (!room) return { ok: false, reason: "no_room" };
      const refused = startRefusal(room, userId, opts.liveMatch);
      if (refused) return { ok: false, reason: refused };
      const roster = seated(roomId).map((s) => ({ ...s }));
      if (!opts.admits(roster)) return { ok: false, reason: "refused", roster };
      for (const [p, position] of opts.renumber ? renumbering(roster) : []) p.seatIndex = position;
      seats.set(roomId, roster);
      const closed: Room = { ...room, status: "in_progress" };
      rooms.set(roomId, closed);
      return { ok: true, room: closed, roster };
    },
  };
  for (const name of Object.keys(port) as (keyof TableRoomPort)[]) {
    t.mock.method(roomStore, name, port[name]);
  }

  return { rooms, seats, rows, epochs };
}
