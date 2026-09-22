import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  createRoomIntent,
  joinRoomIntent,
  spectateRoomIntent,
  type LobbyPort,
} from "../../server/socket/lobbyIntents.ts";
import type { SeatClaim } from "../../server/store/roomStore.ts";

const ROOM = { id: "room-1", code: "ABCDEF", status: "waiting", gameMode: "free_for_all", maxPlayers: 4 };

function fakePort(opts: {
  room?: Partial<typeof ROOM> | null;
  claim?: SeatClaim;
  admit?: { ok: boolean; code?: string };
  watching?: [string, string][];
}) {
  const calls: string[] = [];
  const room = opts.room === null ? undefined : { ...ROOM, ...opts.room };
  const seats = new Map<string, string>();
  const port = {
    userId: "u1",
    socketId: "s1",
    watching: new Map<string, string>(opts.watching ?? []),
    store: {
      createRoom: async (_u: string, mode: string, max: number) => {
        calls.push(`createRoom ${mode} ${max}`);
        return ROOM;
      },
      addRoomPlayer: async (id: string, u: string, seat: number) => {
        calls.push(`addRoomPlayer ${id} ${u} ${seat}`);
      },
      getRoomPlayers: async () => [{}, {}],
      getRoomByCode: async (code: string) => {
        calls.push(`getRoomByCode ${code}`);
        return room;
      },
      claimRoomSeat: async (id: string, u: string) => {
        calls.push(`claimRoomSeat ${id} ${u}`);
        return opts.claim ?? { ok: true, seatIndex: 1, room };
      },
    },
    refuse: (r: { code: string }) => calls.push(`refuse ${r.code}`),
    sendState: (s: { roomId: string }) => calls.push(`sendState ${s.roomId}`),
    broadcastState: (id: string) => calls.push(`broadcastState ${id}`),
    join: (id: string) => calls.push(`join ${id}`),
    seat: async (id: string) => {
      calls.push(`seat ${id}`);
      seats.set("s1", id);
    },
    leave: (id: string) => calls.push(`leave ${id}`),
    roomState: async (r: { id: string }) => ({ roomId: r.id }),
    table: async (d: { kind: string; roomId: string }) => {
      calls.push(`${d.kind} ${d.roomId}`);
      return d.kind === "spectate" ? (opts.admit ?? { ok: true }) : { ok: true };
    },
    announceFilled: async (_r: unknown, seated: number) => {
      calls.push(`announceFilled ${seated}`);
    },
    track: (name: string) => calls.push(`track ${name}`),
  };
  return { port: port as unknown as LobbyPort, calls, seats, watching: port.watching };
}

describe("room:create", () => {
  test("a teams room not sized four is refused before anything is written", async () => {
    const { port, calls } = fakePort({});
    await createRoomIntent(port, { gameMode: "teams", maxPlayers: 3 });
    assert.deepEqual(calls, ["refuse TEAMS_REQUIRE_FOUR"]);
  });

  test("the creator takes seat 0, is mapped to the room and sent its state", async () => {
    const { port, calls, seats } = fakePort({});
    await createRoomIntent(port, { gameMode: "free_for_all", maxPlayers: 4 });
    assert.deepEqual(calls, [
      "createRoom free_for_all 4",
      "addRoomPlayer room-1 u1 0",
      "seat room-1",
      "sendState room-1",
    ]);
    assert.equal(seats.get("s1"), "room-1");
  });
});

describe("room:join", () => {
  test("an unknown code is ROOM_NOT_FOUND, looked up upper-cased", async () => {
    const { port, calls } = fakePort({ room: null });
    assert.equal(await joinRoomIntent(port, { code: "abcdef" }), undefined);
    assert.deepEqual(calls, ["getRoomByCode ABCDEF", "refuse ROOM_NOT_FOUND"]);
  });

  test("a room past waiting is GAME_ALREADY_STARTED", async () => {
    const { port, calls } = fakePort({ room: { status: "playing" } });
    await joinRoomIntent(port, { code: "ABCDEF" });
    assert.deepEqual(calls.slice(1), ["refuse GAME_ALREADY_STARTED"]);
  });

  test("a refused seat claim sends its mapped code and joins nothing", async () => {
    const { port, calls, seats } = fakePort({ claim: { ok: false, reason: "full" } });
    assert.equal(await joinRoomIntent(port, { code: "ABCDEF" }), undefined);
    assert.deepEqual(calls.slice(1), ["claimRoomSeat room-1 u1", "refuse ROOM_FULL"]);
    assert.equal(seats.size, 0);
  });

  test("a claimed seat joins, is tracked, broadcast to the room and checked for fill", async () => {
    const { port, calls, seats } = fakePort({});
    await joinRoomIntent(port, { code: "ABCDEF" });
    assert.deepEqual(calls.slice(1), [
      "claimRoomSeat room-1 u1",
      "seat room-1",
      "track room.joined",
      "broadcastState room-1",
      "announceFilled 2",
    ]);
    assert.equal(seats.get("s1"), "room-1");
  });
});

describe("room:spectate", () => {
  test("an unknown code is refused and acknowledged ROOM_NOT_FOUND", async () => {
    const { port, calls } = fakePort({ room: null });
    const ack = await spectateRoomIntent(port, { code: "ABCDEF" });
    assert.deepEqual(ack, { ok: false, code: "ROOM_NOT_FOUND" });
    assert.deepEqual(calls.slice(1), ["refuse ROOM_NOT_FOUND"]);
  });

  test("a table refusal is passed through, ALREADY_IN_ROOM by name and the rest as GAME_NOT_FOUND", async () => {
    for (const [code, sent] of [
      ["ALREADY_IN_ROOM", "ALREADY_IN_ROOM"],
      ["NO_GAME", "GAME_NOT_FOUND"],
    ]) {
      const { port, calls, watching } = fakePort({ admit: { ok: false, code } });
      assert.deepEqual(await spectateRoomIntent(port, { code: "ABCDEF" }), { ok: false, code });
      assert.deepEqual(calls.slice(1), ["spectate room-1", `refuse ${sent}`]);
      assert.equal(watching.size, 0);
    }
  });

  test("watching a new room leaves the previous one first", async () => {
    const { port, calls, watching } = fakePort({ watching: [["s1", "room-0"]] });
    await spectateRoomIntent(port, { code: "ABCDEF" });
    assert.deepEqual(calls.slice(1), ["spectate room-1", "unspectate room-0", "leave room-0", "join room-1"]);
    assert.equal(watching.get("s1"), "room-1");
  });

  test("re-watching the same room does not unspectate it", async () => {
    const { port, calls } = fakePort({ watching: [["s1", "room-1"]] });
    await spectateRoomIntent(port, { code: "ABCDEF" });
    assert.deepEqual(calls.slice(1), ["spectate room-1", "join room-1"]);
  });
});
