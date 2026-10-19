import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  arm,
  clear,
  clearDisconnectGrace,
  deadline,
  pending,
  pendingKeys,
} from "../../server/game/gameTimers.ts";
import { installClock } from "../../server/http/clock.ts";
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
