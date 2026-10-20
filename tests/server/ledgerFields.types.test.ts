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

const SEAT_FIELDS = ["playerMap", "vacatedSeats", "releasedSeats", "abandonedSeats", "weakSeats", "endMatchVotes"];
const KINDS = ["direct", "collection method", "destructured", "aliased"];

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
  for (const field of SEAT_FIELDS) {
    for (const kind of KINDS) assert.ok(pins.get(field)?.has(kind), `${field} has no ${kind} pin`);
  }
});
