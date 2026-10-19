// Map-backed twins of `activeGameStore` and the `TableRoomPort` methods, so a
// table test needs neither Postgres nor a mock of drizzle's internals.
import type { TestContext } from "node:test";
import { activeGameStore, type TableRoomPort } from "../../server/store/activeGameStore.ts";
import { roomStore } from "../../server/store/roomStore.ts";
import type { Room } from "../../shared/schema.ts";

type Seat = Awaited<ReturnType<TableRoomPort["getRoomPlayers"]>>[number];

export interface MemoryTableStores {
  rooms: Map<string, Room>;
  seats: Map<string, Seat[]>;
  rows: Map<string, unknown>;
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

  t.mock.method(activeGameStore, "load", async (roomId: string) =>
    rows.has(roomId) ? { roomId, gameState: rows.get(roomId) } : undefined
  );
  t.mock.method(activeGameStore, "list", async () =>
    [...rows].map(([roomId, gameState]) => ({ roomId, gameState }))
  );
  t.mock.method(activeGameStore, "write", async (roomId: string, gameState: unknown) => {
    rows.set(roomId, gameState);
  });
  t.mock.method(activeGameStore, "remove", async (roomId: string) => {
    rows.delete(roomId);
  });

  const port: TableRoomPort = {
    getRoomById: async (id) => rooms.get(id) as Room,
    getRoomPlayers: async (roomId) => seated(roomId),
    updateRoomStatus: async (roomId, status) => {
      const room = rooms.get(roomId);
      if (room) rooms.set(roomId, { ...room, status });
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
      const emptied = remaining.length === 0 && room.status === "waiting";
      const wasHost = room.hostUserId === userId;
      const [next] = remaining;
      const updated: Room = emptied
        ? { ...room, status: "finished" }
        : next && !remaining.some((p) => p.userId === room.hostUserId)
          ? { ...room, hostUserId: next.userId }
          : room;
      rooms.set(roomId, updated);
      return { room: updated, remaining, emptied, wasHost };
    },
    closeForStart: async (roomId, userId, opts) => {
      const room = rooms.get(roomId);
      if (!room) return { ok: false, reason: "no_room" };
      if (room.hostUserId !== userId) return { ok: false, reason: "not_host" };
      if (!opts.liveMatch && room.status !== "waiting" && room.status !== "finished") {
        return { ok: false, reason: "not_waiting" };
      }
      const roster = seated(roomId);
      if (!opts.admits(roster)) return { ok: false, reason: "refused", roster };
      const dealt = opts.renumber ? roster.map((s, seatIndex) => ({ ...s, seatIndex })) : roster;
      seats.set(roomId, dealt);
      const closed: Room = { ...room, status: "in_progress" };
      rooms.set(roomId, closed);
      return { ok: true, room: closed, roster: dealt };
    },
  };
  for (const name of Object.keys(port) as (keyof TableRoomPort)[]) {
    t.mock.method(roomStore, name, port[name]);
  }

  return { rooms, seats, rows };
}
