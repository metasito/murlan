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
// A few seconds is `GATE.playMinutes`, and it does not reach a game-over — asserted
// below, so the claim cannot quietly stop being true. The rematch vote, the re-deal
// and the high-water-mark reset are gated nowhere; they belong to soak.yml.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { hasDatabase, skipMessage } from "../helpers/testServer.ts";
import { runSoak, REFUSAL_EVENTS } from "../soak/soak.ts";
import { gate, GATE_PLAY_MS, SLOWEST_TURN_MS } from "../soak/gateBudget.ts";
import { errorEventFor } from "../../server/socketSafety.ts";

const GATE = gate();

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

  // Its own timeout: this is the one test whose cost is a wall clock the runner's
  // speed cannot shorten, and `--test-timeout` serves every other test in the repo.
  test("it deals, plays legal moves, and the table agrees throughout", { timeout: GATE.timeoutMs }, async () => {
    const result = await runSoak(
      { seats: 4, minutes: GATE.playMinutes, seed: 20260829, chaos: 0 },
      () => {}
    );

    assert.ok(
      result.moves > 0,
      "the harness took no turns at all — it is no longer playing the game"
    );
    // The figure `gateBudget`'s bounds are arithmetic on, observed — the arithmetic
    // there cannot notice it going stale.
    assert.ok(
      GATE_PLAY_MS / result.moves <= SLOWEST_TURN_MS,
      `${result.moves} turns in ${GATE_PLAY_MS}ms is ${Math.round(GATE_PLAY_MS / result.moves)}ms ` +
        `a turn, over the ${SLOWEST_TURN_MS}ms gateBudget sizes the window against`
    );
    assert.equal(
      result.manches,
      0,
      "the window now reaches a game-over — this file's header says it does not"
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
