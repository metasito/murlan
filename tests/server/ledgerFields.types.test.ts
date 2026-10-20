import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { OnlineGameState } from "../../server/game/gameRoom.ts";

declare function takesSet<T>(set: Set<T>): void;
declare function takesMap<K, V>(map: Map<K, V>): void;

// Never called: `tsc` is the check. Each line writes a ledger field from outside its ledger, and
// a field that loses its `readonly` turns its lines into unused directives.
export function seatFieldWrites(game: OnlineGameState) {
  // @ts-expect-error direct
  game.playerMap = {};
  // @ts-expect-error collection method
  game.playerMap[0] = "u";
  // @ts-expect-error collection method
  delete game.playerMap[0];
  {
    const { playerMap } = game;
    // @ts-expect-error destructured
    playerMap[0] = "u";
    const alias = game.playerMap;
    // @ts-expect-error aliased
    delete alias[0];
  }

  // @ts-expect-error direct
  game.vacatedSeats = new Map();
  // @ts-expect-error collection method
  game.vacatedSeats.set(0, { userId: "u", username: "U" });
  {
    const { vacatedSeats } = game;
    // @ts-expect-error destructured
    vacatedSeats.delete(0);
    const alias = game.vacatedSeats;
    // @ts-expect-error aliased
    alias.clear();
    // @ts-expect-error passed to a mutating parameter
    takesMap(game.vacatedSeats);
  }

  // @ts-expect-error direct
  game.releasedSeats = new Set();
  // @ts-expect-error collection method
  game.releasedSeats.add("u");
  {
    const { releasedSeats } = game;
    // @ts-expect-error destructured
    releasedSeats.delete("u");
    const alias = game.releasedSeats;
    // @ts-expect-error aliased
    alias.clear();
    // @ts-expect-error passed to a mutating parameter
    takesSet(game.releasedSeats);
  }

  // @ts-expect-error direct
  game.abandonedSeats = new Map();
  // @ts-expect-error collection method
  game.abandonedSeats.set(0, "u");
  {
    const { abandonedSeats } = game;
    // @ts-expect-error destructured
    abandonedSeats.delete(0);
    const alias = game.abandonedSeats;
    // @ts-expect-error aliased
    alias.clear();
    // @ts-expect-error passed to a mutating parameter
    takesMap(game.abandonedSeats);
  }

  // @ts-expect-error direct
  game.weakSeats = new Set();
  // @ts-expect-error collection method
  game.weakSeats.add(0);
  {
    const { weakSeats } = game;
    // @ts-expect-error destructured
    weakSeats.add(0);
    const alias = game.weakSeats;
    // @ts-expect-error aliased
    alias.clear();
    // @ts-expect-error passed to a mutating parameter
    takesSet(game.weakSeats);
  }

  // @ts-expect-error direct
  game.endMatchVotes = new Set();
  // @ts-expect-error collection method
  game.endMatchVotes.add("u");
  {
    const { endMatchVotes } = game;
    // @ts-expect-error destructured
    endMatchVotes.delete("u");
    const alias = game.endMatchVotes;
    // @ts-expect-error aliased
    alias.clear();
    // @ts-expect-error passed to a mutating parameter
    takesSet(game.endMatchVotes);
  }
}

export function matchFieldWrites(game: OnlineGameState) {
  // @ts-expect-error direct
  game.rematchVotes = new Set();
  // @ts-expect-error collection method
  game.rematchVotes.add("u");
  {
    const { rematchVotes } = game;
    // @ts-expect-error destructured
    rematchVotes.delete("u");
    const alias = game.rematchVotes;
    // @ts-expect-error aliased
    alias.clear();
    // @ts-expect-error passed to a mutating parameter
    takesSet(game.rematchVotes);
  }

  // @ts-expect-error direct
  game.cumulativeScores = {};
  // @ts-expect-error collection method
  game.cumulativeScores.u = 1;
  // @ts-expect-error collection method
  delete game.cumulativeScores.u;
  {
    const { cumulativeScores } = game;
    // @ts-expect-error destructured
    cumulativeScores.u += 1;
    const alias = game.cumulativeScores;
    // @ts-expect-error aliased
    delete alias.u;
  }

  // @ts-expect-error direct
  game.matchTarget = 31;
  // @ts-expect-error compound
  game.matchTarget += 10;

  // @ts-expect-error direct
  game.roundsPlayed = 0;
  // @ts-expect-error compound
  game.roundsPlayed++;

  // @ts-expect-error direct
  game.matchOver = true;

  // @ts-expect-error direct
  game.endedByVote = true;
  // @ts-expect-error delete
  delete game.endedByVote;
}

const COLLECTION = ["direct", "collection method", "destructured", "aliased"];
const PINS: Record<string, string[]> = {
  playerMap: COLLECTION,
  vacatedSeats: COLLECTION,
  releasedSeats: COLLECTION,
  abandonedSeats: COLLECTION,
  weakSeats: COLLECTION,
  endMatchVotes: COLLECTION,
  rematchVotes: COLLECTION,
  cumulativeScores: COLLECTION,
  matchTarget: ["direct", "compound"],
  roundsPlayed: ["direct", "compound"],
  matchOver: ["direct"],
  endedByVote: ["direct", "delete"],
};

function pinsByField(): Map<string, Set<string>> {
  const source = readFileSync(new URL(import.meta.url), "utf8");
  const blocks = source.split("// @ts-expect-error direct\n").slice(1);
  return new Map(
    blocks.map((block) => [
      /game\.(\w+) =/.exec(block)?.[1] ?? "",
      new Set(["direct", ...[...block.matchAll(/@ts-expect-error ([a-z ]+)$/gm)].map((m) => m[1])]),
    ])
  );
}

test("every ledger field is pinned for every kind of write", () => {
  const pins = pinsByField();
  assert.equal(Object.keys(PINS).length, 12);
  for (const [field, kinds] of Object.entries(PINS)) {
    for (const kind of kinds) assert.ok(pins.get(field)?.has(kind), `${field} has no ${kind} pin`);
  }
});
