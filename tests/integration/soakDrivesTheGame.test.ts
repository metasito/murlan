// tests/integration/soakDrivesTheGame.test.ts — the soak still plays.
//
// The soak itself is a search, and a search belongs nowhere near a pull
// request's critical path: a run that finds something is a run that fails, and
// gating on it would redden `main` for a defect the branch never introduced.
// What *is* safe to gate on is that the harness still drives the game at all —
// a soak that silently stopped playing would report "no disagreement" forever
// and nobody would notice.
//
// So: no chaos, a few seconds, and the only claim is that cards left hands.
//
// A few seconds is `GATE.playMinutes`, and what that window does not reach is a
// game-over: nine seconds is around seventeen turns, and a four-handed manche
// runs far past that. The rematch vote, the re-deal and the high-water-mark
// reset below are exercised by `npm run soak` and by soak.yml, never here — and
// they were not exercised here at 24s either, where `result.manches` was already
// 0. What this run gates is the turn: a deal, legal moves, and four views that
// agree over every one of them.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { hasDatabase, skipMessage } from "../helpers/testServer.ts";
import { runSoak, REFUSAL_EVENTS } from "../soak/soak.ts";
import { GATE } from "../soak/gateBudget.ts";
import { errorEventFor } from "../../server/socketSafety.ts";

describe("the soak harness drives a real game", {
  skip: hasDatabase() ? false : skipMessage(),
}, () => {
  let restore: (() => void) | undefined;

  before(() => {
    // The runner's own progress lines would drown the test output.
    const original = console.log;
    console.log = () => {};
    restore = () => {
      console.log = original;
    };
  });
  after(() => restore?.());

  // Its own timeout, not the suite's: this is the one test whose cost is a wall
  // clock the runner's speed cannot shorten, and `--test-timeout` is a single
  // number serving every other test in the repo. `gateBudget` derives both halves
  // from the window, so neither can be retuned without the other.
  test("it deals, plays legal moves, and the table agrees throughout", { timeout: GATE.timeoutMs }, async () => {
    const result = await runSoak(
      { seats: 4, minutes: GATE.playMinutes, seed: 20260829, chaos: 0 },
      () => {}
    );

    assert.ok(
      result.moves > 0,
      "the harness took no turns at all — it is no longer playing the game"
    );
    assert.deepEqual(
      result.violations,
      [],
      `a quiet four-handed table disagreed with itself: ${JSON.stringify(result.violations)}`
    );
    assert.equal(result.chaosEvents.length, 0, "chaos was off for this run");
  });

  // The night this matters, the report reads "and the server said nothing at
  // all". That sentence is only true if the harness is listening on the events
  // the server actually refuses with — a rename on either side turns it into a
  // confident lie about where the defect is.
  test("it hears a refusal on the events the server refuses with", () => {
    assert.ok(
      REFUSAL_EVENTS.includes(errorEventFor("game:rejoin") as never),
      `the soak listens on ${REFUSAL_EVENTS.join(", ")}, not ${errorEventFor("game:rejoin")}`
    );
    assert.ok(REFUSAL_EVENTS.includes("game:rejoin_failed"));
  });
});
