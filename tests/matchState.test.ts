// tests/matchState.test.ts — the seat a results board celebrates.
//
// Both modes draw the same board, so the name on it is derived once. What the
// candidates are differs (offline has a third fallback the overlay does not),
// but the rule for reading them cannot.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { celebration, isDrawnHand } from "../lib/matchState.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const TABLE = [
  { id: "player_0", name: "Alice", team: "A" },
  { id: "player_1", name: "Bob", team: "B" },
  { id: "player_2", name: "Carl", team: "A" },
];

const teamLabel = (team: string) => `Team ${team}`;

describe("celebration", () => {
  test("takes the first candidate that names a seat", () => {
    assert.equal(celebration(TABLE, ["player_1", "player_0"], null), "Bob");
  });

  // A client that rejoins a table which finished while it was away never
  // receives `game:over`, so it holds `over: true` with no winners at all.
  test("passes over an undefined candidate rather than rendering nothing", () => {
    assert.equal(celebration(TABLE, [undefined, "player_2"], null), "Carl");
  });

  // The winner id outliving the seat it named is the same shape as the hole
  // above, and the one a `find(c => c !== undefined)` would swallow: the
  // candidate is present, so the fallback behind it never gets its turn.
  test("passes over a candidate that names no seat", () => {
    assert.equal(celebration(TABLE, ["player_9", "player_0"], null), "Alice");
  });

  test("names the team rather than the seat when one is asked for", () => {
    assert.equal(celebration(TABLE, ["player_1"], teamLabel), "Team B");
  });

  test("names the seat where a team mode table has none", () => {
    assert.equal(celebration([{ id: "p", name: "Solo" }], ["p"], teamLabel), "Solo");
  });

  // Never the id: it reaches the screen as `player_0`, which reads as a
  // rendering fault rather than as the missing name it is.
  test("is empty when no candidate names a seat", () => {
    assert.equal(celebration(TABLE, [undefined, "player_9"], null), "");
    assert.equal(celebration(TABLE, [], null), "");
  });
});

// RULES.md §11: first-and-fourth (3+0) pays the same total as second-and-
// third (2+1), so a manche can end with both teams tied.
describe("isDrawnHand", () => {
  const TEAMS_TABLE = [
    { id: "player_0", team: "A" },
    { id: "player_1", team: "B" },
    { id: "player_2", team: "B" },
    { id: "player_3", team: "A" },
  ];

  test("first-and-fourth against second-and-third is a draw", () => {
    const handScores = { player_0: 3, player_1: 2, player_2: 1, player_3: 0 };
    assert.equal(isDrawnHand(TEAMS_TABLE, handScores), true);
  });

  test("a team that placed both members ahead is not a draw", () => {
    const handScores = { player_0: 3, player_1: 1, player_2: 0, player_3: 2 };
    assert.equal(isDrawnHand(TEAMS_TABLE, handScores), false);
  });

  test("a table with no team assignment is never a draw", () => {
    const handScores = { player_0: 3, player_1: 2, player_2: 1, player_3: 0 };
    assert.equal(
      isDrawnHand(
        TEAMS_TABLE.map(({ id }) => ({ id })),
        handScores
      ),
      false
    );
  });
});

// `lib/autoMove.ts` was written to be the one bot rule and landed with only
// the server calling it, so the offline copy stayed live behind a green
// extraction: every check passed, because each mode's tests exercised its own
// implementation. Counting the callers of the engine's move chooser is the
// fact that distinguishes one implementation from two — a second one has to
// call it, whatever else it does.
test("one module chooses a bot's move", () => {
  const CHOOSER = "aiChoosePlay";
  const HOME = "lib/autoMove.ts";
  const callers = ["app", "components", "context", "lib", "server"]
    .flatMap((dir) => walk(path.join(repoRoot, dir)))
    .filter((rel) => rel !== "lib/gameEngine.ts")
    .filter((rel) =>
      new RegExp(String.raw`\b${CHOOSER}\s*\(`).test(readFileSync(path.join(repoRoot, rel), "utf8"))
    );

  assert.deepEqual(
    callers,
    [HOME],
    `${CHOOSER} is how a seat's move is chosen, so a second caller is a second ` +
      `bot. Route it through ${HOME} instead: ${callers.join(", ")}`
  );
});

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") out.push(...walk(full));
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(path.relative(repoRoot, full).split(path.sep).join("/"));
    }
  }
  return out;
}
