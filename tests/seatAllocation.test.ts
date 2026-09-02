// tests/seatAllocation.test.ts — who sits where, and which seats are spoken for.
//
// The arithmetic behind #679. Two friends who quick-matched into a teams room
// took seats 0 and 1, and `teamForSeat` puts 0+2 against 1+3, so the room sat
// them on opposite sides. The hold and the emptier-side rule are both here,
// with the clock passed in rather than waited on.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { heldSeats, seatForClaim } from "../server/seatAllocation.ts";
import type { SeatInvite, SeatedPlayer } from "../server/seatAllocation.ts";
import { teamForSeat, TEAMS_PLAYER_COUNT } from "../lib/gameEngine.ts";

const HOLD_MS = 120_000;
const NOW = 1_700_000_000_000;

const teamsRoom = { maxPlayers: TEAMS_PLAYER_COUNT, gameMode: "teams" };
const freeForAllRoom = { maxPlayers: TEAMS_PLAYER_COUNT, gameMode: "free_for_all" };

function seats(...pairs: [string, number][]): SeatedPlayer[] {
  return pairs.map(([userId, seatIndex]) => ({ userId, seatIndex }));
}

function invite(inviterId: string, inviteeId: string, ageMs = 0): SeatInvite {
  return { inviterId, inviteeId, createdAt: new Date(NOW - ageMs) };
}

const base = { now: NOW, holdMs: HOLD_MS };

describe("a seat held for an invited friend", () => {
  test("is the seat on the inviter's own side", () => {
    const held = heldSeats({
      ...base,
      room: teamsRoom,
      seated: seats(["host", 0]),
      invites: [invite("host", "friend")],
    });
    assert.deepEqual(
      held.map((h) => h.seatIndex),
      [2],
      "seat 2 is the host's partner; seat 1 is an opponent"
    );
    assert.equal(
      teamForSeat(2, TEAMS_PLAYER_COUNT, "teams"),
      teamForSeat(0, TEAMS_PLAYER_COUNT, "teams"),
      "and that is the same side the host is on"
    );
  });

  test("holds the partner seat of whichever seat the inviter is in", () => {
    const held = heldSeats({
      ...base,
      room: teamsRoom,
      seated: seats(["stranger", 0], ["host", 1]),
      invites: [invite("host", "friend")],
    });
    assert.deepEqual(held.map((h) => h.seatIndex), [3]);
  });

  test("is not given to a stranger who claims a seat", () => {
    const seated = seats(["host", 0], ["strangerA", 1]);
    const input = {
      ...base,
      room: teamsRoom,
      seated,
      invites: [invite("host", "friend")],
    };
    assert.deepEqual(heldSeats(input).map((h) => h.seatIndex), [2]);
    assert.equal(
      seatForClaim({ ...input, userId: "strangerB" }),
      3,
      "the lowest free seat is 2, and 2 is being held"
    );
  });

  test("is the seat the friend gets when they arrive", () => {
    assert.equal(
      seatForClaim({
        ...base,
        room: teamsRoom,
        seated: seats(["host", 0], ["strangerA", 1], ["strangerB", 3]),
        invites: [invite("host", "friend")],
        userId: "friend",
      }),
      2
    );
  });

  test("refuses a stranger outright when every free seat is held", () => {
    assert.equal(
      seatForClaim({
        ...base,
        room: teamsRoom,
        seated: seats(["host", 0]),
        invites: [invite("host", "a"), invite("host", "b"), invite("host", "c")],
        userId: "stranger",
      }),
      null,
      "four friends: three seats held, nothing left to give away"
    );
  });

  test("lapses when the invite is older than the hold", () => {
    // The last free seat, so the hold is the only thing that can refuse the
    // stranger and its lapsing is the only thing that can let them in.
    const input = (ageMs: number) => ({
      ...base,
      room: teamsRoom,
      seated: seats(["host", 0], ["strangerA", 1], ["strangerB", 3]),
      invites: [invite("host", "friend", ageMs)],
      userId: "latecomer",
    });
    assert.equal(seatForClaim(input(0)), null, "held, so there is nothing to give");
    assert.deepEqual(heldSeats(input(HOLD_MS + 1)), [], "two minutes on, the hold is gone");
    assert.equal(
      seatForClaim(input(HOLD_MS + 1)),
      2,
      "so a stranger may take the seat it was holding"
    );
  });

  test("holds up to the last millisecond and not past it", () => {
    const held = (ageMs: number) =>
      heldSeats({
        ...base,
        room: teamsRoom,
        seated: seats(["host", 0]),
        invites: [invite("host", "friend", ageMs)],
      });
    assert.equal(held(HOLD_MS - 1).length, 1, "one millisecond left is still held");
    assert.equal(held(HOLD_MS).length, 0, "and the millisecond it runs out it is not");
  });

  test("reports when the hold ends, so the room can stop promising it", () => {
    const [hold] = heldSeats({
      ...base,
      room: teamsRoom,
      seated: seats(["host", 0]),
      invites: [invite("host", "friend", 30_000)],
    });
    assert.equal(hold?.expiresAt, NOW + HOLD_MS - 30_000);
  });

  test("stops holding a seat for someone who has already sat down", () => {
    assert.deepEqual(
      heldSeats({
        ...base,
        room: teamsRoom,
        seated: seats(["host", 0], ["friend", 2]),
        invites: [invite("host", "friend")],
      }),
      [],
      "the invite outlives the arrival; the hold must not"
    );
  });

  test("is not taken out of a free-for-all lobby, which has no sides", () => {
    assert.deepEqual(
      heldSeats({
        ...base,
        room: freeForAllRoom,
        seated: seats(["host", 0]),
        invites: [invite("host", "friend")],
      }),
      []
    );
  });
});

describe("the seat a newcomer is given", () => {
  test("is on the side with fewer players, not the lowest free index", () => {
    assert.equal(
      seatForClaim({
        ...base,
        room: teamsRoom,
        seated: seats(["a", 2]),
        invites: [],
        userId: "b",
      }),
      1,
      "seat 0 is free and is the side seat 2 is already on"
    );
  });

  test("is the lowest free seat when the sides are level", () => {
    assert.equal(
      seatForClaim({
        ...base,
        room: teamsRoom,
        seated: seats(["a", 1]),
        invites: [],
        userId: "b",
      }),
      0
    );
  });

  test("is the lowest free seat in a room with no sides at all", () => {
    assert.equal(
      seatForClaim({
        ...base,
        room: freeForAllRoom,
        seated: seats(["a", 2]),
        invites: [],
        userId: "b",
      }),
      0
    );
  });

  test("is null when the room is full", () => {
    assert.equal(
      seatForClaim({
        ...base,
        room: teamsRoom,
        seated: seats(["a", 0], ["b", 1], ["c", 2], ["d", 3]),
        invites: [],
        userId: "e",
      }),
      null
    );
  });

  /**
   * The two friends of #679, both arriving through quick match with no invite
   * between them: the seats they take must still be a pair, or the feature
   * only ever worked for the friend who was invited.
   */
  test("puts the two sides at two each however the seats were vacated", () => {
    const seated = seats(["a", 0]);
    const b = seatForClaim({ ...base, room: teamsRoom, seated, invites: [], userId: "b" });
    assert.equal(b, 1);
    const c = seatForClaim({
      ...base,
      room: teamsRoom,
      seated: [...seated, { userId: "b", seatIndex: b! }],
      invites: [],
      userId: "c",
    });
    assert.equal(c, 2);
    assert.notEqual(
      teamForSeat(0, TEAMS_PLAYER_COUNT, "teams"),
      teamForSeat(1, TEAMS_PLAYER_COUNT, "teams")
    );
  });
});
