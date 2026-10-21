import { test } from "node:test";
import assert from "node:assert/strict";
import { moveSince, turnOf } from "../../lib/game/moves.ts";
import { simulateOfflineMatch } from "../helpers/offlineMatch.ts";
import { mulberry32 } from "../support/game.ts";
import type { LastMove } from "../../lib/game/gameEngine.ts";

const deal: LastMove = { seq: 0, kind: "deal" };
const play: LastMove = { seq: 3, kind: "play", seat: 1 };
const pass: LastMove = { seq: 4, kind: "pass", seat: 2, closedTrick: false };

test("with nothing seen, the move is new", () => {
  assert.equal(moveSince(null, deal), deal);
  assert.equal(moveSince(undefined, pass), pass);
});

test("the move already seen is not new, whichever object carries it", () => {
  assert.equal(moveSince(pass, pass), null);
  assert.equal(moveSince({ ...pass }, pass), null, "a re-sent state parses into a new object");
});

test("a later move is new", () => {
  assert.equal(moveSince(play, pass), pass);
});

test("the next round's deal is new after the last round's moves", () => {
  assert.equal(moveSince(pass, deal), deal);
});

test("a move that shares a count with one from another round is still new", () => {
  assert.equal(moveSince({ seq: 4, kind: "play", seat: 2 }, pass), pass);
  assert.equal(moveSince({ seq: 4, kind: "pass", seat: 1, closedTrick: false }, pass), pass);
});

test("the turn key changes on every move a real match makes, a giveback and a new round's deal among them", () => {
  const seen = { giveback: 0, turnover: 0, moves: 0 };
  for (let seed = 1; seed <= 10; seed++) {
    simulateOfflineMatch({
      seed,
      players: [0, 1, 2].map((i) => ({ name: `Bot${i}`, type: "bot" as const })),
      gameMode: "free_for_all",
      length: "match",
      botRng: mulberry32,
      onTransition: (prev, next) => {
        if (prev === null) return;
        seen.moves++;
        if (next.lastMove.kind === "giveback") seen.giveback++;
        if (prev.roundOver) seen.turnover++;
        assert.notEqual(turnOf(next), turnOf(prev), `seed ${seed}, move ${next.lastMove.seq} kept the key`);
      },
    });
  }
  assert.ok(seen.giveback > 0 && seen.turnover > 0, `only ${JSON.stringify(seen)}`);
});
