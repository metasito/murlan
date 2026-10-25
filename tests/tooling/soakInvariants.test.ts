// tests/tooling/soakInvariants.test.ts — the soak's oracle can fail.
//
// A soak that runs for an hour and reports nothing is indistinguishable from a
// soak whose checks are blind. Every invariant here is handed a table that is
// wrong on purpose and must say so, and a table that is right and must not.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blankComments } from "../helpers/sourceScan.ts";
import {
  checkAgreement,
  checkAll,
  checkDuplicate,
  checkLandedOnce,
  checkRefused,
  checkRepeatAnswered,
  checkUnchanged,
  injectionViolations,
  checkTeardown,
  checkCards,
  checkTotalNeverGrows,
  checkTurnIsSeated,
  progressViolations,
  staleReachViolations,
  type SeatView,
  type Violation,
} from "../soak/invariants.ts";
import { failureReport, INTENT_FAULTS, type SeatAction, type SoakResult } from "../soak/soak.ts";

test("a soak that finished no round fails rather than reporting no disagreement", () => {
  assert.deepEqual(progressViolations({ moves: 560, rounds: 5 }), []);
  assert.deepEqual(progressViolations({ moves: 40, rounds: 0 }).map((v) => v.kind), ["no-progress"]);
  assert.deepEqual(progressViolations({ moves: 0, rounds: 0 }).map((v) => v.kind), ["no-progress"]);
  const main = blankComments(readFileSync(new URL("../soak/soak.ts", import.meta.url), "utf8"));
  assert.match(main, /const result = await runSoak\(opts\);\s*result\.violations\.push\(\.\.\.progressViolations\(result\)\);/);
});

test("a run with chaos on that injected no fault fails rather than reporting no disagreement", () => {
  assert.deepEqual(injectionViolations({ chaos: 0, injected: 0 }), []);
  assert.deepEqual(injectionViolations({ chaos: 0.05, injected: 3 }), []);
  assert.deepEqual(injectionViolations({ chaos: 0.05, injected: 0 }).map((v) => v.kind), ["no-faults-injected"]);
  const main = blankComments(readFileSync(new URL("../soak/soak.ts", import.meta.url), "utf8"));
  assert.match(
    main,
    /result\.violations\.push\(\.\.\.injectionViolations\(\{ chaos: opts\.chaos, injected: countOf\(result\.moveLog, INTENT_FAULTS\) \}\)\);/
  );
  assert.ok(!INTENT_FAULTS.includes("drop" as never), "a drop is not one of the faults this floor is for");
  assert.equal(INTENT_FAULTS.length, 6);
});

test("a run whose stale plays never reached their seat's turn fails rather than reporting no disagreement", () => {
  assert.deepEqual(staleReachViolations({ armed: 0, injected: 0 }), []);
  assert.deepEqual(staleReachViolations({ armed: 1, injected: 0 }), [], "one arming can lose to the round ending");
  assert.deepEqual(staleReachViolations({ armed: 4, injected: 1 }), []);
  assert.deepEqual(staleReachViolations({ armed: 2, injected: 0 }).map((v) => v.kind), ["stale-never-reached"]);
  const main = blankComments(readFileSync(new URL("../soak/soak.ts", import.meta.url), "utf8"));
  assert.match(
    main,
    /result\.violations\.push\(\.\.\.staleReachViolations\(\{ armed: result\.staleArmed, injected: countOf\(result\.moveLog, \["stale"\]\) \}\)\);/
  );
});

const DECK = 54;

/** Two seats looking at the same four-handed table, and agreeing. */
function agreeingPair(): SeatView[] {
  return [
    { seat: 0, currentTurnIndex: 1, roundOver: false, handCounts: [3, 4], ownHand: ["a", "b", "c"], seq: 5 },
    { seat: 1, currentTurnIndex: 1, roundOver: false, handCounts: [3, 4], ownHand: ["d", "e", "f", "g"], seq: 5 },
  ];
}

describe("the soak's oracle", () => {
  test("says nothing about a table everyone agrees on", () => {
    assert.deepEqual(checkAll(agreeingPair(), DECK, 7), []);
  });

  test("a single view cannot disagree with itself", () => {
    assert.deepEqual(checkAgreement([agreeingPair()[0]]), []);
  });

  test("catches two clients on different turns", () => {
    const views = agreeingPair();
    views[1].currentTurnIndex = 0;
    const found = checkAgreement(views);
    assert.equal(found.length, 1);
    assert.equal(found[0].kind, "turn-disagreement");
  });

  test("catches one client thinking the round is over", () => {
    const views = agreeingPair();
    views[1].roundOver = true;
    assert.equal(checkAgreement(views)[0]?.kind, "over-disagreement");
  });

  test("catches clients disagreeing about how many cards a seat holds", () => {
    const views = agreeingPair();
    views[1].handCounts = [3, 5];
    // The count is also this seat's own, so the own-hand check fires too; the
    // agreement check is the one under test.
    assert.equal(checkAgreement(views)[0]?.kind, "hand-count-disagreement");
  });

  /** The defect `CLAUDE.md` calls the worst one available. */
  test("catches the same card in two hands", () => {
    const views = agreeingPair();
    views[1].ownHand = ["a", "e", "f", "g"];
    const found = checkCards(views, DECK);
    assert.equal(found[0]?.kind, "card-in-two-hands");
    assert.match(found[0].detail, /card a/);
  });

  test("catches a client holding cards the table was not told about", () => {
    const views = agreeingPair();
    views[0].ownHand = ["a", "b"];
    assert.equal(checkCards(views, DECK)[0]?.kind, "own-hand-mismatch");
  });

  test("catches more cards in play than the deck holds", () => {
    const views = agreeingPair();
    views[0].handCounts = [40, 40];
    views[1].handCounts = [40, 40];
    const kinds = checkCards(views, DECK).map((v) => v.kind);
    assert.ok(kinds.includes("more-cards-than-deck"), kinds.join(","));
  });

  test("catches a turn pointing at a seat that is not there", () => {
    const views = agreeingPair();
    views[0].currentTurnIndex = 7;
    views[1].currentTurnIndex = 7;
    assert.equal(checkTurnIsSeated(views)[0]?.kind, "turn-off-the-table");
  });

  /** A finished hand has nobody to act, and the server says so with -1. */
  test("allows no-one's turn once the round is over", () => {
    const views = agreeingPair().map((v) => ({ ...v, roundOver: true, currentTurnIndex: -1 }));
    assert.deepEqual(checkTurnIsSeated(views), []);
  });

  test("catches cards appearing out of nowhere", () => {
    assert.equal(checkTotalNeverGrows(agreeingPair(), 6)[0]?.kind, "cards-appeared");
  });

  /** The exchange moves one card between two hands, and must not trip this. */
  test("allows a card moving from one hand to another", () => {
    const before = agreeingPair();
    const after = agreeingPair();
    after[0].handCounts = [2, 5];
    after[1].handCounts = [2, 5];
    after[0].ownHand = ["a", "b"];
    after[1].ownHand = ["d", "e", "f", "g", "c"];
    const total = before[0].handCounts.reduce((a, b) => a + b, 0);
    assert.deepEqual(checkTotalNeverGrows(after, total), []);
    assert.deepEqual(checkAll(after, DECK, total), []);
  });
});

describe("the soak's teardown check", () => {
  test("says nothing when every map is empty", () => {
    assert.deepEqual(checkTeardown({ activeGames: new Map(), inFlight: new Set() }), []);
  });

  test("names each map still holding entries", () => {
    const found = checkTeardown({ activeGames: new Map([["r", 1]]), botTimers: new Map(), inFlight: new Set(["a", "b"]) });
    assert.deepEqual(found.map((v) => v.detail), [
      "activeGames still holds 1 entries after teardown",
      "inFlight still holds 2 entries after teardown",
    ]);
  });
});

/** `agreeingPair` after seat 1, on move, played its `d`. */
const PLAY_D: SeatAction = { kind: "play", seat: 1, cardIds: ["d"] };
function afterPlayingD(): SeatView[] {
  return agreeingPair().map((v) => ({
    ...v,
    currentTurnIndex: 0,
    seq: 6,
    handCounts: [3, 3],
    ownHand: v.seat === 1 ? ["e", "f", "g"] : v.ownHand,
  }));
}

describe("the oracle for a move under a fault", () => {
  test("says nothing about a move that landed once", () => {
    assert.deepEqual(checkLandedOnce("a restart", agreeingPair(), afterPlayingD(), PLAY_D), []);
  });

  test("catches a move that landed twice", () => {
    const after = afterPlayingD().map((v) => ({ ...v, seq: 7 }));
    assert.equal(checkLandedOnce("a restart", agreeingPair(), after, PLAY_D)[0]?.kind, "move-not-landed-once");
  });

  test("catches a move the restart lost", () => {
    assert.equal(checkLandedOnce("a restart", agreeingPair(), agreeingPair(), PLAY_D)[0]?.kind, "move-not-landed-once");
  });

  test("catches a restart that handed a seat back a different hand", () => {
    const after = afterPlayingD();
    after[0].ownHand = ["a", "b", "x"];
    assert.deepEqual(checkLandedOnce("a restart", agreeingPair(), after, PLAY_D).map((v) => v.kind), ["move-landed-wrong"]);
  });

  test("catches a count moving at a seat that did not move", () => {
    const after = afterPlayingD().map((v) => ({ ...v, handCounts: [2, 3] }));
    assert.ok(checkLandedOnce("a restart", agreeingPair(), after, PLAY_D).every((v) => v.kind === "move-landed-wrong"));
    assert.equal(checkLandedOnce("a restart", agreeingPair(), after, PLAY_D).length, 2);
  });

  test("catches a seat that lost its view", () => {
    assert.equal(checkLandedOnce("a restart", agreeingPair(), afterPlayingD().slice(1), PLAY_D)[0]?.kind, "move-not-landed-once");
  });

  test("a giveback lands its one card in exactly one other hand", () => {
    const give: SeatAction = { kind: "exchange", seat: 1, cardId: "d" };
    const after = afterPlayingD().map((v) => ({
      ...v,
      handCounts: [4, 3],
      ownHand: v.seat === 0 ? ["a", "b", "c", "d"] : v.ownHand,
    }));
    assert.deepEqual(checkLandedOnce("a duplicate", agreeingPair(), after, give), []);
    const vanished = afterPlayingD();
    assert.ok(checkLandedOnce("a duplicate", agreeingPair(), vanished, give).length > 0, "the card left one hand and reached none");
  });
});

describe("the oracle for a duplicated intent", () => {
  const OK = { ok: true };

  test("says nothing when both copies are answered alike and the move lands once", () => {
    assert.deepEqual(checkDuplicate(OK, OK, agreeingPair(), afterPlayingD(), PLAY_D), []);
  });

  test("catches the copies answered differently", () => {
    const found = checkDuplicate(OK, { ok: false, code: "NOT_YOUR_TURN" }, agreeingPair(), afterPlayingD(), PLAY_D);
    assert.deepEqual(found.map((v) => v.kind), ["duplicate-ack-differs"]);
  });

  test("catches a copy never answered", () => {
    assert.equal(checkDuplicate(OK, null, agreeingPair(), afterPlayingD(), PLAY_D)[0]?.kind, "fault-unanswered");
  });

  test("catches the duplicate applied as a second move", () => {
    const after = afterPlayingD().map((v) => ({ ...v, seq: 7 }));
    assert.equal(checkDuplicate(OK, OK, agreeingPair(), after, PLAY_D)[0]?.kind, "move-not-landed-once");
  });

  test("a refused intent duplicated changes nothing", () => {
    const no = { ok: false, code: "INVALID_CARD" };
    assert.deepEqual(checkDuplicate(no, no, agreeingPair(), agreeingPair(), PLAY_D), []);
    assert.equal(checkDuplicate(no, no, agreeingPair(), afterPlayingD(), PLAY_D)[0]?.kind, "fault-changed-view");
  });
});

describe("the oracle for an intent the table must refuse", () => {
  const REFUSED = { ok: false, code: "NOT_YOUR_TURN" };

  test("says nothing about a refusal that changed nothing", () => {
    assert.deepEqual(checkRefused("an early pass", REFUSED, agreeingPair(), agreeingPair(), "NOT_YOUR_TURN"), []);
  });

  test("a hand sent back in another order is the same hand", () => {
    const after = agreeingPair();
    after[1].ownHand = ["g", "f", "e", "d"];
    assert.deepEqual(checkUnchanged("a stale play", agreeingPair(), after), []);
  });

  test("catches the intent accepted", () => {
    assert.equal(checkRefused("a late pass", { ok: true }, agreeingPair(), agreeingPair())[0]?.kind, "fault-accepted");
  });

  test("catches the wrong refusal", () => {
    const found = checkRefused("an early pass", { ok: false, code: "CANNOT_PASS" }, agreeingPair(), agreeingPair(), "NOT_YOUR_TURN");
    assert.deepEqual(found.map((v) => v.kind), ["fault-wrong-refusal"]);
  });

  test("catches no answer at all", () => {
    assert.equal(checkRefused("a stale play", null, agreeingPair(), agreeingPair())[0]?.kind, "fault-unanswered");
  });

  test("catches a refusal that moved the table anyway", () => {
    for (const change of [
      (v: SeatView) => ({ ...v, seq: 6 }),
      (v: SeatView) => ({ ...v, currentTurnIndex: 0 }),
      (v: SeatView) => ({ ...v, roundOver: true }),
      (v: SeatView) => ({ ...v, handCounts: [3, 3] }),
      (v: SeatView) => ({ ...v, ownHand: v.ownHand.slice(1) }),
    ]) {
      const found = checkRefused("a late pass", REFUSED, agreeingPair(), agreeingPair().map(change));
      assert.deepEqual(found.map((v) => v.kind), ["fault-changed-view", "fault-changed-view"]);
    }
  });

  test("catches a seat left with no view", () => {
    assert.deepEqual(checkUnchanged("a restart", agreeingPair(), agreeingPair().slice(1)).map((v) => v.kind), ["fault-changed-view"]);
  });
});

describe("a failed run's report", () => {
  /** Every fault oracle, made to fire. */
  const planted: Violation[] = [
    ...checkLandedOnce("a restart", agreeingPair(), agreeingPair(), PLAY_D),
    ...checkLandedOnce("a restart", agreeingPair(), afterPlayingD().map((v) => ({ ...v, handCounts: [2, 3] })), PLAY_D),
    ...checkDuplicate({ ok: true }, { ok: false }, agreeingPair(), afterPlayingD(), PLAY_D),
    ...checkRefused("a late pass", { ok: true }, agreeingPair(), afterPlayingD()),
    ...checkRefused("an early pass", { ok: false, code: "CANNOT_PASS" }, agreeingPair(), agreeingPair(), "NOT_YOUR_TURN"),
    ...checkRefused("a stale play", null, agreeingPair(), agreeingPair()),
    ...injectionViolations({ chaos: 0.05, injected: 0 }),
    ...staleReachViolations({ armed: 2, injected: 0 }),
    ...checkRepeatAnswered("a late pass", { ok: true }, { ok: false, code: "NOT_YOUR_TURN" }, agreeingPair(), agreeingPair()),
    ...checkRefused("a pass re-sent after a restart", { ok: true }, agreeingPair(), afterPlayingD()),
  ];

  const result: SoakResult = {
    violations: planted,
    moves: 150,
    rounds: 1,
    chaosEvents: [],
    refusals: {},
    seed: 31,
    moveLog: [
      { at: 0, kind: "deal", round: 0, hands: [["a"], ["b"]] },
      { at: 1, kind: "play", seat: 0, cardIds: ["a"] },
      { at: 1, kind: "deal", round: 1, hands: [["c"], ["d"]] },
      { at: 2, kind: "pass", seat: 1 },
      { at: 2, kind: "restart" },
      { at: 2, kind: "restart-duplicate", move: { kind: "pass", seat: 1 }, intentId: "i1", landed: true },
    ],
    firstViolationAt: 2,
    staleArmed: 0,
  };

  test("is caught by soak.yml's grep, line for line", () => {
    const workflow = readFileSync(new URL("../../.github/workflows/soak.yml", import.meta.url), "utf8");
    const pattern = /grep -aE '([^']+)' soak\.log/.exec(workflow)?.[1];
    assert.ok(pattern, "soak.yml no longer greps soak.log for the report");
    const caught = new RegExp(pattern);
    const kinds = new Set(planted.map((v) => v.kind));
    for (const kind of [
      "move-not-landed-once",
      "move-landed-wrong",
      "duplicate-ack-differs",
      "fault-accepted",
      "fault-changed-view",
      "fault-wrong-refusal",
      "fault-unanswered",
      "no-faults-injected",
      "stale-never-reached",
    ]) {
      assert.ok(kinds.has(kind), `no planted failure fires ${kind}`);
    }
    const lines = failureReport(result);
    const failed = lines.filter((line) => line.startsWith("soak: FAILED"));
    assert.equal(failed.length, 1);
    assert.match(failed[0], caught);
    assert.match(failed[0], /seed 31, first violation at move 2\)/);
    for (const v of planted) {
      const line = lines.find((l) => l.startsWith(`  [${v.kind}]`) && l.endsWith(v.detail));
      assert.ok(line, `${v.kind} is not in the report`);
      assert.match(line, caught, `soak.yml's grep misses ${line}`);
    }
  });

  test("prints the round the first violation fell in, from its deal", () => {
    const json = JSON.parse(failureReport(result).at(-1)!);
    assert.deepEqual(json.map((e: { kind: string }) => e.kind), ["deal", "pass", "restart", "restart-duplicate"]);
    assert.equal(json[0].round, 1);
  });
});

describe("the oracle for an intent re-sent while the server still remembers it", () => {
  const OK = { ok: true };

  test("says nothing when it is answered as before and nothing moves", () => {
    assert.deepEqual(checkRepeatAnswered("a late pass", OK, OK, agreeingPair(), agreeingPair()), []);
  });

  test("catches it judged afresh instead of answered from memory", () => {
    const found = checkRepeatAnswered("a late pass", OK, { ok: false, code: "NOT_YOUR_TURN" }, agreeingPair(), agreeingPair());
    assert.deepEqual(found.map((v) => v.kind), ["duplicate-ack-differs"]);
  });

  test("catches it applied again", () => {
    assert.ok(checkRepeatAnswered("a late pass", OK, OK, agreeingPair(), afterPlayingD()).some((v) => v.kind === "fault-changed-view"));
  });

  test("catches no answer", () => {
    assert.equal(checkRepeatAnswered("a late pass", OK, null, agreeingPair(), agreeingPair())[0]?.kind, "fault-unanswered");
  });
});
