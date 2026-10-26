import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  afkTimeoutMs,
  arm,
  autoStartDelayMs,
  botMoveDelayMs,
  clear,
  clearAfkTimer,
  clearAllTimersForUser,
  clearDisconnectGrace,
  clearLobbyGrace,
  clearRoomTimers,
  clearTurnTimers,
  deadline,
  disconnectGraceMs,
  lobbyGraceMs,
  pending,
  pendingKeys,
  seatHoldMs,
  seatKey,
  secondsUntil,
  stateAckTimeoutMs,
  sweepIntervalMs,
  TIMER_KINDS,
  usersInLobbyGrace,
  voteDeadlineMs,
} from "../../server/game/gameTimers.ts";
import { TURN_TIMEOUT_MS } from "../../lib/game/gameEngine.ts";
import { BOT_THINK_MS } from "../../lib/game/turnSchedule.ts";
import { installClock, type Clock } from "../../server/http/clock.ts";
import { fakeClock } from "../helpers/fakeClock.ts";

let restoreClock = () => {};

const USER = "game-timers-user";

afterEach(() => {
  clear("disconnect", USER);
  restoreClock();
});

describe("a timer armed through gameTimers", () => {
  test("records its deadline on the injected clock and drops it when it fires", () => {
    const clock = fakeClock();
    restoreClock = installClock(clock);
    let fired = 0;
    let pendingInside: boolean | undefined;

    arm("disconnect", USER, 60_000, () => {
      fired++;
      pendingInside = pending("disconnect", USER);
    });
    assert.equal(deadline("disconnect", USER), clock.now() + 60_000);
    assert.equal(pending("disconnect", USER), true);

    clock.advance(59_999);
    assert.equal(fired, 0, "fired before its deadline");
    assert.equal(pending("disconnect", USER), true);

    clock.advance(1);
    assert.equal(fired, 1);
    assert.equal(pendingInside, false, "still pending inside its own handler, so a re-arm there is skipped");
    assert.equal(pending("disconnect", USER), false);
    assert.equal(deadline("disconnect", USER), undefined, "the deadline outlived its timer");
    assert.deepEqual(pendingKeys("disconnect").filter((k) => k === USER), []);
  });

  test("re-arming replaces the timer and its deadline together", () => {
    const clock = fakeClock();
    restoreClock = installClock(clock);
    let first = 0;
    let second = 0;

    arm("disconnect", USER, 10_000, () => first++);
    clock.advance(5_000);
    arm("disconnect", USER, 10_000, () => second++);
    assert.equal(deadline("disconnect", USER), clock.now() + 10_000);

    clock.advance(10_000);
    assert.equal(first, 0, "the replaced timer still fired");
    assert.equal(second, 1);
  });

  test("clearing it drops the deadline with the timer", () => {
    const clock = fakeClock();
    restoreClock = installClock(clock);
    let fired = 0;

    arm("disconnect", USER, 10_000, () => fired++);
    assert.equal(clearDisconnectGrace(USER), true);
    assert.equal(deadline("disconnect", USER), undefined);
    assert.equal(pending("disconnect", USER), false);
    assert.equal(clearDisconnectGrace(USER), false, "a second clear claimed a grace was still armed");

    clock.advance(10_000);
    assert.equal(fired, 0, "a cleared timer fired");
  });
});

const KNOBS: { name: string; env: string; read: () => number; fallback: number }[] = [
  { name: "afkTimeoutMs", env: "MURLAN_AFK_TIMEOUT_MS", read: afkTimeoutMs, fallback: TURN_TIMEOUT_MS },
  { name: "disconnectGraceMs", env: "MURLAN_DISCONNECT_GRACE_MS", read: disconnectGraceMs, fallback: 60_000 },
  { name: "lobbyGraceMs", env: "MURLAN_LOBBY_GRACE_MS", read: lobbyGraceMs, fallback: 20_000 },
  { name: "seatHoldMs", env: "MURLAN_SEAT_HOLD_MS", read: seatHoldMs, fallback: 120_000 },
  { name: "stateAckTimeoutMs", env: "MURLAN_STATE_ACK_TIMEOUT_MS", read: stateAckTimeoutMs, fallback: 5_000 },
  { name: "botMoveDelayMs", env: "MURLAN_BOT_MOVE_DELAY_MS", read: botMoveDelayMs, fallback: BOT_THINK_MS },
  { name: "sweepIntervalMs", env: "MURLAN_SWEEP_INTERVAL_MS", read: sweepIntervalMs, fallback: 5 * 60_000 },
  { name: "autoStartDelayMs", env: "MURLAN_AUTOSTART_DELAY_MS", read: autoStartDelayMs, fallback: 4_000 },
  { name: "voteDeadlineMs", env: "MURLAN_VOTE_DEADLINE_MS", read: voteDeadlineMs, fallback: 30_000 },
];

describe("a timeout knob", () => {
  const saved = new Map(KNOBS.map((k) => [k.env, process.env[k.env]]));
  afterEach(() => {
    for (const [env, value] of saved) {
      if (value === undefined) delete process.env[env];
      else process.env[env] = value;
    }
  });

  for (const knob of KNOBS) {
    test(`${knob.name} takes its own environment override, and a bad one falls back to its default`, () => {
      // Each other knob is set to a value no default equals, so reading the wrong variable shows.
      for (const other of KNOBS) process.env[other.env] = "777777";

      process.env[knob.env] = "1234";
      assert.equal(knob.read(), 1234);

      for (const bad of ["", "0", "-5", "abc", "Infinity", "NaN"]) {
        process.env[knob.env] = bad;
        assert.equal(knob.read(), knob.fallback, `"${bad}" was taken as a timeout`);
      }

      delete process.env[knob.env];
      assert.equal(knob.read(), knob.fallback);
    });
  }
});

describe("whole seconds left on a deadline", () => {
  test("round up, floor at zero, and are zero when nothing is armed", () => {
    const clock = fakeClock();
    restoreClock = installClock(clock);
    assert.equal(secondsUntil(undefined), 0);
    assert.equal(secondsUntil(clock.now() + 1_500), 2);
    assert.equal(secondsUntil(clock.now() + 1_000), 1);
    assert.equal(secondsUntil(clock.now()), 0);
    assert.equal(secondsUntil(clock.now() - 5_000), 0);
  });
});

describe("what keeps the process alive", () => {
  test("a lobby grace and a vote deadline are unref'd and no other timer is", () => {
    const unref: string[] = [];
    let kind = "";
    const clock: Clock = {
      now: () => 0,
      setTimeout: () => ({ unref: () => void unref.push(kind) }),
      clearTimeout: () => {},
    };
    restoreClock = installClock(clock);
    try {
      for (const k of TIMER_KINDS) {
        kind = k;
        arm(k, "unref-key", 1_000, () => {});
      }
      assert.deepEqual(unref.sort(), ["lobbyGrace", "voteDeadline"]);
    } finally {
      for (const k of TIMER_KINDS) clear(k, "unref-key");
    }
  });
});

describe("clearing a room's timers", () => {
  const A = "timers-room-a";
  const B = "timers-room-b";
  const noop = () => {};

  afterEach(() => {
    for (const room of [A, B, "timers-room-a1"]) {
      clearRoomTimers(room);
      for (const user of ["u1", "u2"]) clearAllTimersForUser(user, room);
    }
  });

  test("clearTurnTimers stops this room's AFK and bot timers and leaves every other room's", () => {
    restoreClock = installClock(fakeClock());
    arm("afk", seatKey(A, "u1"), 5_000, noop);
    arm("bot", A, 5_000, noop);
    arm("afk", seatKey(B, "u1"), 5_000, noop);
    arm("bot", B, 5_000, noop);
    arm("afk", seatKey("timers-room-a1", "u1"), 5_000, noop);

    clearTurnTimers(A);

    assert.equal(pending("afk", seatKey(A, "u1")), false);
    assert.equal(pending("bot", A), false);
    assert.equal(pending("afk", seatKey(B, "u1")), true, "another room's AFK timer was stopped");
    assert.equal(pending("bot", B), true, "another room's bot timer was stopped");
    assert.equal(pending("afk", seatKey("timers-room-a1", "u1")), true, "a room sharing the id's prefix was stopped");
  });

  test("clearAfkTimer stops that seat's AFK timer alone", () => {
    restoreClock = installClock(fakeClock());
    let fired = 0;
    arm("afk", seatKey(A, "u1"), 5_000, () => fired++);
    arm("afk", seatKey(A, "u2"), 5_000, noop);

    clearAfkTimer(A, "u1");

    assert.equal(pending("afk", seatKey(A, "u1")), false);
    assert.equal(pending("afk", seatKey(A, "u2")), true);
    assert.equal(fired, 0);
  });

  test("usersInLobbyGrace names the users held in this room, and not those held in another", () => {
    restoreClock = installClock(fakeClock());
    arm("lobbyGrace", seatKey(A, "u1"), 5_000, noop);
    arm("lobbyGrace", seatKey(B, "u2"), 5_000, noop);

    assert.deepEqual(usersInLobbyGrace(A), ["u1"]);
    assert.deepEqual(usersInLobbyGrace(B), ["u2"]);
    assert.equal(clearLobbyGrace(A, "u2"), false);
  });

  test("clearAllTimersForUser with a room stops the user's grace, AFK window and lobby hold there", () => {
    restoreClock = installClock(fakeClock());
    arm("disconnect", "u1", 5_000, noop);
    arm("afk", seatKey(A, "u1"), 5_000, noop);
    arm("lobbyGrace", seatKey(A, "u1"), 5_000, noop);
    arm("afk", seatKey(A, "u2"), 5_000, noop);

    clearAllTimersForUser("u1", A);

    assert.equal(pending("disconnect", "u1"), false);
    assert.equal(pending("afk", seatKey(A, "u1")), false);
    assert.equal(pending("lobbyGrace", seatKey(A, "u1")), false);
    assert.equal(pending("afk", seatKey(A, "u2")), true);
  });

  test("clearAllTimersForUser without a room stops the disconnect grace and nothing held in a room", () => {
    restoreClock = installClock(fakeClock());
    arm("disconnect", "u1", 5_000, noop);
    arm("afk", seatKey(A, "u1"), 5_000, noop);

    clearAllTimersForUser("u1");

    assert.equal(pending("disconnect", "u1"), false);
    assert.equal(pending("afk", seatKey(A, "u1")), true);
  });
});
