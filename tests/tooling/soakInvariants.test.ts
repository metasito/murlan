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
  checkTeardown,
  checkCards,
  checkTotalNeverGrows,
  checkTurnIsSeated,
  progressViolations,
  type SeatView,
} from "../soak/invariants.ts";

test("a soak that finished no manche fails rather than reporting no disagreement", () => {
  assert.deepEqual(progressViolations({ moves: 560, manches: 5 }), []);
  assert.deepEqual(progressViolations({ moves: 40, manches: 0 }).map((v) => v.kind), ["no-progress"]);
  assert.deepEqual(progressViolations({ moves: 0, manches: 0 }).map((v) => v.kind), ["no-progress"]);
  const main = blankComments(readFileSync(new URL("../soak/soak.ts", import.meta.url), "utf8"));
  assert.match(main, /const result = await runSoak\(opts\);\s*result\.violations\.push\(\.\.\.progressViolations\(result\)\);/);
});

const DECK = 54;

/** Two seats looking at the same four-handed table, and agreeing. */
function agreeingPair(): SeatView[] {
  return [
    { seat: 0, currentTurnIndex: 1, gameOver: false, handCounts: [3, 4], ownHand: ["a", "b", "c"] },
    { seat: 1, currentTurnIndex: 1, gameOver: false, handCounts: [3, 4], ownHand: ["d", "e", "f", "g"] },
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

  test("catches one client thinking the hand is over", () => {
    const views = agreeingPair();
    views[1].gameOver = true;
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
  test("allows no-one's turn once the hand is over", () => {
    const views = agreeingPair().map((v) => ({ ...v, gameOver: true, currentTurnIndex: -1 }));
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
