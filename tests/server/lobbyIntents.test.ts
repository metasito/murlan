import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  createRoomIntent,
  joinRoomIntent,
  quickmatchIntent,
  rejoinRoomIntent,
  setVisibilityIntent,
  spectateRoomIntent,
  type LobbyPort,
} from "../../server/socket/lobbyIntents.ts";
import type { SeatClaim } from "../../server/store/roomStore.ts";
import { payload } from "../../server/shared/payload.ts";

const ROOM = {
  id: "room-1",
  code: "ABCDEF",
  status: "waiting",
  gameMode: "free_for_all",
  maxPlayers: 4,
  hostUserId: "u1",
};

interface Candidate {
  room: typeof ROOM;
  playerCount: number;
  containsUser: boolean;
}

function fakePort(opts: {
  room?: Partial<typeof ROOM> | null;
  claim?: SeatClaim;
  claims?: Record<string, SeatClaim>;
  admit?: { ok: boolean; code?: string };
  watching?: [string, string][];
  seated?: string[];
  waiting?: Candidate[];
}) {
  const calls: string[] = [];
  const room = opts.room === null ? undefined : { ...ROOM, ...opts.room };
  const seats = new Map<string, string>();
  const port = {
    userId: "u1",
    socketId: "s1",
    watching: new Map<string, string>(opts.watching ?? []),
    store: {
      createRoom: async (_u: string, mode: string, max: number, visibility = "private", autoStart = false) => {
        calls.push(`createRoom ${mode} ${max} ${visibility} ${autoStart}`);
        return ROOM;
      },
      addRoomPlayer: async (id: string, u: string, seat: number) => {
        calls.push(`addRoomPlayer ${id} ${u} ${seat}`);
      },
      getRoomPlayers: async () => (opts.seated ?? ["u0", "u1"]).map((userId) => ({ userId })),
      getRoomByCode: async (code: string) => {
        calls.push(`getRoomByCode ${code}`);
        return room;
      },
      getRoomById: async (id: string) => {
        calls.push(`getRoomById ${id}`);
        return room;
      },
      claimRoomSeat: async (id: string, u: string) => {
        calls.push(`claimRoomSeat ${id} ${u}`);
        return opts.claims?.[id] ?? opts.claim ?? { ok: true, seatIndex: 1, room: { ...room, id } };
      },
      updateRoomVisibility: async (id: string, visibility: string) => {
        calls.push(`updateRoomVisibility ${id} ${visibility}`);
      },
      findWaitingPublicRooms: async () => opts.waiting ?? [],
    },
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
    announceChanged: async (id: string) => {
      calls.push(`announceChanged ${id}`);
    },
    clearLobbyGrace: (id: string, u: string) => calls.push(`clearLobbyGrace ${id} ${u}`),
    track: (name: string) => calls.push(`track ${name}`),
  };
  return { port: port as unknown as LobbyPort, calls, seats, watching: port.watching };
}

const told = (code: Parameters<typeof payload>[0]) => ({ ok: false, code, notice: payload(code) });

describe("room:create", () => {
  test("a teams room not sized four is refused before anything is written", async () => {
    const { port, calls } = fakePort({});
    assert.deepEqual(await createRoomIntent(port, { gameMode: "teams", maxPlayers: 3 }), told("TEAMS_REQUIRE_FOUR"));
    assert.deepEqual(calls, []);
  });

  test("the creator takes seat 0, is mapped to the room and sent its state", async () => {
    const { port, calls, seats } = fakePort({});
    assert.deepEqual(await createRoomIntent(port, { gameMode: "free_for_all", maxPlayers: 4 }), { ok: true });
    assert.deepEqual(calls, [
      "createRoom free_for_all 4 private false",
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
    assert.deepEqual(await joinRoomIntent(port, { code: "abcdef" }), told("ROOM_NOT_FOUND"));
    assert.deepEqual(calls, ["getRoomByCode ABCDEF"]);
  });

  test("a room past waiting is GAME_ALREADY_STARTED", async () => {
    const { port, calls } = fakePort({ room: { status: "playing" } });
    assert.deepEqual(await joinRoomIntent(port, { code: "ABCDEF" }), told("GAME_ALREADY_STARTED"));
    assert.deepEqual(calls.slice(1), []);
  });

  test("a refused seat claim returns its mapped code and joins nothing", async () => {
    const { port, calls, seats } = fakePort({ claim: { ok: false, reason: "full" } });
    assert.deepEqual(await joinRoomIntent(port, { code: "ABCDEF" }), told("ROOM_FULL"));
    assert.deepEqual(calls.slice(1), ["claimRoomSeat room-1 u1"]);
    assert.equal(seats.size, 0);
  });

  test("a claimed seat joins, is broadcast to the room, checked for fill and tracked", async () => {
    const { port, calls, seats } = fakePort({});
    assert.deepEqual(await joinRoomIntent(port, { code: "ABCDEF" }), { ok: true });
    assert.deepEqual(calls.slice(1), [
      "claimRoomSeat room-1 u1",
      "seat room-1",
      "broadcastState room-1",
      "announceFilled 2",
      "track room.joined",
    ]);
    assert.equal(seats.get("s1"), "room-1");
  });
});

describe("room:spectate", () => {
  test("an unknown code is refused ROOM_NOT_FOUND", async () => {
    const { port, calls } = fakePort({ room: null });
    assert.deepEqual(await spectateRoomIntent(port, { code: "ABCDEF" }), told("ROOM_NOT_FOUND"));
    assert.deepEqual(calls.slice(1), []);
  });

  test("a table refusal is told ALREADY_IN_ROOM by name and the rest as GAME_NOT_FOUND", async () => {
    for (const [code, sent] of [
      ["ALREADY_IN_ROOM", "ALREADY_IN_ROOM"],
      ["NO_GAME", "GAME_NOT_FOUND"],
    ] as const) {
      const { port, calls, watching } = fakePort({ admit: { ok: false, code } });
      assert.deepEqual(await spectateRoomIntent(port, { code: "ABCDEF" }), told(sent));
      assert.deepEqual(calls.slice(1), ["spectate room-1"]);
      assert.equal(watching.size, 0);
    }
  });

  test("watching a new room leaves the previous one first", async () => {
    const { port, calls, watching } = fakePort({ watching: [["s1", "room-0"]] });
    assert.deepEqual(await spectateRoomIntent(port, { code: "ABCDEF" }), { ok: true });
    assert.deepEqual(calls.slice(1), ["spectate room-1", "unspectate room-0", "leave room-0", "join room-1"]);
    assert.equal(watching.get("s1"), "room-1");
  });

  test("re-watching the same room does not unspectate it", async () => {
    const { port, calls } = fakePort({ watching: [["s1", "room-1"]] });
    await spectateRoomIntent(port, { code: "ABCDEF" });
    assert.deepEqual(calls.slice(1), ["spectate room-1", "join room-1"]);
  });
});

describe("room:rejoin", () => {
  test("an unknown code is ROOM_NOT_FOUND", async () => {
    const { port } = fakePort({ room: null });
    assert.deepEqual(await rejoinRoomIntent(port, { code: "abcdef" }), told("ROOM_NOT_FOUND"));
  });

  test("a caller holding no seat row is NOT_IN_ROOM, and nothing is claimed", async () => {
    const { port, calls } = fakePort({ seated: ["u0"] });
    assert.deepEqual(await rejoinRoomIntent(port, { code: "ABCDEF" }), told("NOT_IN_ROOM"));
    assert.deepEqual(calls.slice(1), []);
  });

  test("a refused claim returns its mapped code", async () => {
    const { port, seats } = fakePort({ claim: { ok: false, reason: "not_waiting" } });
    assert.deepEqual(await rejoinRoomIntent(port, { code: "ABCDEF" }), told("GAME_ALREADY_STARTED"));
    assert.equal(seats.size, 0);
  });

  test("a seat already held is taken back: seated, grace cleared, room told", async () => {
    const { port, calls } = fakePort({ claim: { ok: false, reason: "already_joined", room: ROOM as never } });
    assert.deepEqual(await rejoinRoomIntent(port, { code: "ABCDEF" }), { ok: true });
    assert.deepEqual(calls.slice(1), [
      "claimRoomSeat room-1 u1",
      "seat room-1",
      "clearLobbyGrace room-1 u1",
      "broadcastState room-1",
    ]);
  });
});

describe("room:setVisibility", () => {
  test("a socket at no table is NOT_AT_A_TABLE, told nothing", async () => {
    const { port, calls } = fakePort({});
    assert.deepEqual(await setVisibilityIntent(port, null, { visibility: "public" }), {
      ok: false,
      code: "NOT_AT_A_TABLE",
    });
    assert.deepEqual(calls, []);
  });

  test("a missing room, a guest and a started room are each refused, and nothing is written", async () => {
    for (const [room, code] of [
      [null, "ROOM_NOT_FOUND"],
      [{ hostUserId: "u2" }, "NOT_HOST"],
      [{ status: "in_progress" }, "GAME_ALREADY_STARTED"],
    ] as const) {
      const { port, calls } = fakePort({ room });
      assert.deepEqual(await setVisibilityIntent(port, "room-1", { visibility: "public" }), told(code));
      assert.deepEqual(calls, ["getRoomById room-1"]);
    }
  });

  test("the host's change is written and announced", async () => {
    const { port, calls } = fakePort({});
    assert.deepEqual(await setVisibilityIntent(port, "room-1", { visibility: "public" }), { ok: true });
    assert.deepEqual(calls, ["getRoomById room-1", "updateRoomVisibility room-1 public", "announceChanged room-1"]);
  });
});

describe("room:quickmatch", () => {
  const candidate = (id: string, over: Partial<Candidate> = {}): Candidate => ({
    room: { ...ROOM, id },
    playerCount: 1,
    containsUser: false,
    ...over,
  });

  test("a teams match not sized four is refused before any room is looked at", async () => {
    const { port, calls } = fakePort({ waiting: [candidate("r1")] });
    assert.deepEqual(await quickmatchIntent(port, { gameMode: "teams", maxPlayers: 3 }), told("TEAMS_REQUIRE_FOUR"));
    assert.deepEqual(calls, []);
  });

  test("a matching room is claimed through the same tail as a join", async () => {
    const { port, calls } = fakePort({
      waiting: [
        candidate("mine", { containsUser: true }),
        candidate("empty", { playerCount: 0 }),
        candidate("small", { room: { ...ROOM, id: "small", maxPlayers: 2 } }),
        candidate("lost"),
        candidate("r1"),
      ],
      claims: { lost: { ok: false, reason: "full" } },
    });
    assert.deepEqual(await quickmatchIntent(port, { gameMode: "free_for_all", maxPlayers: 4 }), { ok: true });
    assert.deepEqual(calls, [
      "claimRoomSeat lost u1",
      "claimRoomSeat r1 u1",
      "seat r1",
      "broadcastState r1",
      "announceFilled 2",
    ]);
  });

  test("with nothing to join, a public matchmade room is created", async () => {
    const { port, calls } = fakePort({});
    assert.deepEqual(await quickmatchIntent(port, { gameMode: "free_for_all", maxPlayers: 4 }), { ok: true });
    assert.deepEqual(calls, [
      "createRoom free_for_all 4 public true",
      "addRoomPlayer room-1 u1 0",
      "seat room-1",
      "sendState room-1",
    ]);
  });
});
