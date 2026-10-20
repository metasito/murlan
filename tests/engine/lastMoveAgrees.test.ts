import { test } from "node:test";
import assert from "node:assert/strict";
import type { GameState } from "../../lib/game/gameEngine.ts";
import { exchangeAnnouncementOf } from "../../lib/game/sharedGameFlow.ts";
import { seatsJustPassed, trickClosedWithWinner, turnKey } from "../../components/passes.ts";
import { simulateOfflineMatch, type OfflinePlayerSetup } from "../helpers/offlineMatch.ts";
import { mulberry32 } from "../support/game.ts";

const MATCHES = 25;

const passView = (state: GameState) => ({
  currentTurnIndex: state.currentTurnIndex,
  lastPlayedBy: state.lastPlayedBy,
  lastPlayedCombination: state.lastPlayedCombination,
  trickWinner: state.trickWinner,
  outOfCards: state.players.map((p) => p.hand.length === 0),
});

function agrees(prev: GameState | null, next: GameState): void {
  const move = next.lastMove;
  if (prev === null || move.kind === "deal") {
    assert.deepEqual(move, { seq: 0, kind: "deal" }, "a deal is move 0, and only a deal is");
    assert.ok(prev === null || prev.roundOver, "a deal follows a finished round");
  } else {
    assert.equal(move.seq, prev.lastMove.seq + 1, "each move counts one");
    assert.notEqual(turnKey(prev), turnKey(next), "the old key moved with the move");
  }
  if (prev === null) return;

  const trickClosed = prev.lastPlayedCombination !== null && next.lastPlayedCombination === null;
  assert.equal(move.kind === "pass", next.passCount > prev.passCount || (move.kind !== "deal" && trickClosed), "a pass is what raised passCount or closed the trick");
  if (move.kind === "pass") {
    assert.equal(move.closedTrick, trickClosedWithWinner(next), "closedTrick is the trick that closed");
    assert.equal(move.seat, prev.currentTurnIndex, "the seat on move passed");
  }
  if (move.kind === "play") assert.equal(move.seat, prev.currentTurnIndex, "the seat on move played");
  if (move.kind === "giveback") assert.equal(move.seat, prev.exchangePhase?.winnerIdx, "the exchange winner gave back");

  if (move.kind !== "deal") {
    assert.deepEqual(seatsJustPassed(passView(prev), passView(next)), move.kind === "pass" ? [move.seat] : [], "the seats seen passing");
  }
  const announces = move.kind === "giveback" || (move.kind === "deal" && next.exchangePhase?.twoJokerException === true);
  assert.equal(exchangeAnnouncementOf(prev, next) !== null, announces, "the exchange announces on a giveback or a two-Joker deal");
}

for (const seats of [2, 3, 4]) {
  test(`lastMove agrees with the table's derivations at ${seats} seats`, () => {
    const players: OfflinePlayerSetup[] = Array.from({ length: seats }, (_, i) => ({ name: `Bot${i}`, type: "bot" }));
    let checked = 0;
    for (let seed = 1; seed <= MATCHES; seed++) {
      simulateOfflineMatch({
        seed,
        players,
        gameMode: "free_for_all",
        length: "match",
        botRng: mulberry32,
        onTransition: (prev, next) => {
          checked++;
          try {
            agrees(prev, next);
          } catch (err) {
            throw new Error(`seed ${seed}, move ${next.lastMove.seq}: ${(err as Error).message}`, { cause: err });
          }
        },
      });
    }
    assert.ok(checked > MATCHES * 50, `only ${checked} transitions checked`);
  });
}
