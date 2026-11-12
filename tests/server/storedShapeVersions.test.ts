import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DOCUMENTS, type Document, shapeHashes, shapes, STORED_SHAPES as SHAPES } from "../helpers/storedShapes.ts";
import { atMain, rewritten } from "../helpers/appendOnly.ts";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");

function edit(file: string, from: string, to: string): Record<string, string> {
  const source = read(file);
  assert.ok(source.includes(from), `${file} no longer holds ${JSON.stringify(from)}`);
  return { [file]: source.replace(from, to) };
}

let current: Record<Document, string> | undefined;

for (const name of Object.keys(DOCUMENTS) as Document[]) {
  test(`the stored ${name} shape does not change without its version`, () => {
    const atBase = atMain(SHAPES) as Partial<Record<Document, Record<string, string>>> | undefined;
    const recorded: Record<Document, Record<string, string>> = JSON.parse(read(SHAPES));
    const { version, bump, golden } = DOCUMENTS[name];
    for (const at of Object.keys(recorded[name] ?? {})) {
      assert.ok(Number(at) <= version, `${name} records version ${at}, above ${bump} (${version})`);
    }
    const base = atBase?.[name];
    if (atBase) assert.deepEqual(rewritten(base ?? {}, recorded[name] ?? {}), [], `${SHAPES} only grows: \`npm run regen\` restores what origin/main records for ${name}`);
    current ??= shapeHashes();
    // assert.ok, not equal: equal's report prints the hash, and a hash pasted from a log skips the
    // generator's refusal to replace what origin/main records.
    assert.ok(
      current[name] === recorded[name]?.[String(version)],
      recorded[name]?.[String(version)] !== undefined
        ? `the stored ${name} shape changed at version ${version}. Bump ${bump}, then run \`npm run regen\`.${golden}`
        : `no ${name} shape is recorded for version ${version}: run \`npm run regen\`.${golden}`
    );
  });
}

test("the shape hash moves with the stored document and nothing else", () => {
  const base = shapeHashes();
  const moved = (override: Record<string, string>) => {
    const next = shapeHashes(override);
    return (Object.keys(base) as Document[]).filter((d) => next[d] !== base[d]);
  };
  const GAME = "lib/game/gameEngine.ts";
  const MATCH = "lib/game/matchState.ts";

  assert.deepEqual(
    moved(edit(GAME, "export interface GameState {\n", "export interface GameState {\n  extra: number;\n")),
    ["activeGames", "offlineSave", "wire"],
    "an extra GameState field"
  );
  assert.deepEqual(
    moved(edit("shared/persistedEnvelope.ts", "  roundsPlayed: z.number()", "  roundsCount: z.number()")),
    ["activeGames"],
    "a renamed persistedMatchSchema key"
  );
  assert.deepEqual(
    moved(edit(MATCH, "  rounds: RoundResult[];\n}", "  rounds: RoundResult[];\n  extra: number;\n}")),
    ["offlineSave"],
    "an extra MatchState field"
  );
  assert.deepEqual(
    moved(edit("shared/protocol.ts", "handCount: number; vacated: boolean }", "handCount: number; vacated: boolean; extra: number }")),
    ["wire"],
    "an extra WirePlayer field"
  );
  assert.deepEqual(
    moved(edit("shared/protocol.ts", "  matchOver: z.boolean(),\n  matchWinnerIds", "  matchOver: z.boolean(),\n  extra: z.number(),\n  matchWinnerIds")),
    ["activeGames", "wire"],
    "an extra RoundOverPayload field, which a pending round stores"
  );
  assert.deepEqual(
    moved(
      edit(
        GAME,
        "  players: Player[];\n  currentTurnIndex: number;\n",
        "  // a comment\n  currentTurnIndex: number;\n  players: Player[];\n"
      )
    ),
    [],
    "a comment and a property reorder"
  );
  assert.throws(
    () => shapes(edit(GAME, "export interface GameState {\n", "export interface GameState {\n  seen: Set<string>;\n")),
    /not JSON: \S*\.seen is Set<string>/
  );
});
