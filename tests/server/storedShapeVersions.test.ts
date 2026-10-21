import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { GAME_SCHEMA_VERSION } from "../../shared/persistedEnvelope.ts";
import { OFFLINE_SAVE_VERSION } from "../../lib/offlineSave.ts";
import { PROTOCOL_VERSION } from "../../shared/protocol.ts";
import { programFor, shapeHash, typeShape } from "../helpers/typeShape.ts";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");

const PROBE = "tests/server/storedShapeProbe.ts";
const PROBE_TEXT = [
  `import type { toEnvelope } from "../../server/game/tableState.ts";`,
  `import type { OfflineSave } from "../../lib/offlineSave.ts";`,
  `import type { ClientToServerEvents, ServerToClientEvents } from "../../shared/protocol.ts";`,
  `type Sent<A> = { [I in keyof A]: A[I] extends (...reply: infer R) => void ? R : A[I] };`,
  `type Payloads<M> = { [E in keyof M]: M[E] extends (...args: infer A) => void ? Sent<A> : never };`,
  `export type activeGames = ReturnType<typeof toEnvelope>;`,
  `export type offlineSave = OfflineSave;`,
  `export type wire = { toClient: Payloads<ServerToClientEvents>; toServer: Payloads<ClientToServerEvents> };`,
].join("\n");

const DOCUMENTS = {
  activeGames: {
    version: GAME_SCHEMA_VERSION,
    bump: "GAME_SCHEMA_VERSION in shared/persistedEnvelope.ts",
    golden: "",
  },
  offlineSave: {
    version: OFFLINE_SAVE_VERSION,
    bump: "OFFLINE_SAVE_VERSION in lib/offlineSave.ts",
    golden: " and regenerate tests/fixtures/offlineSave.json through encodeOfflineSave",
  },
  wire: {
    version: PROTOCOL_VERSION,
    bump: "PROTOCOL_VERSION in shared/protocol.ts",
    golden: ", raising MIN_PROTOCOL_VERSION if bundles in the field cannot read the change",
  },
} as const;
type Document = keyof typeof DOCUMENTS;

function shapes(override: Record<string, string> = {}): Record<Document, string> {
  const program = programFor([PROBE], { [PROBE]: PROBE_TEXT, ...override });
  const checker = program.getTypeChecker();
  const probe = program.getSourceFile(path.join(root, PROBE))!;
  const exports = checker.getExportsOfModule(checker.getSymbolAtLocation(probe)!);
  const shapeOf = (name: Document) =>
    typeShape(checker, checker.getDeclaredTypeOfSymbol(exports.find((s) => s.name === name)!));
  return { activeGames: shapeOf("activeGames"), offlineSave: shapeOf("offlineSave"), wire: shapeOf("wire") };
}

const hashes = (override?: Record<string, string>) => {
  const s = shapes(override);
  return { activeGames: shapeHash(s.activeGames), offlineSave: shapeHash(s.offlineSave), wire: shapeHash(s.wire) };
};

function edit(file: string, from: string, to: string): Record<string, string> {
  const source = read(file);
  assert.ok(source.includes(from), `${file} no longer holds ${JSON.stringify(from)}`);
  return { [file]: source.replace(from, to) };
}

let current: Record<Document, string> | undefined;

for (const name of Object.keys(DOCUMENTS) as Document[]) {
  test(`the stored ${name} shape does not change without its version`, () => {
    const recorded: Record<Document, Record<string, string>> = JSON.parse(read("tests/fixtures/storedShapes.json"));
    const { version, bump, golden } = DOCUMENTS[name];
    for (const at of Object.keys(recorded[name] ?? {})) {
      assert.ok(Number(at) <= version, `${name} records version ${at}, above ${bump} (${version})`);
    }
    current ??= hashes();
    assert.equal(
      current[name],
      recorded[name]?.[String(version)],
      recorded[name]?.[String(version)] === undefined
        ? `no ${name} shape is recorded for version ${version}: add "${name}" → "${version}": "${current[name]}" ` +
            `to tests/fixtures/storedShapes.json${golden}.`
        : `the stored ${name} shape changed at version ${version}. Bump ${bump}, add the new hash under ` +
            `"${name}" → "<new version>" in tests/fixtures/storedShapes.json${golden}.`
    );
  });
}

test("the shape hash moves with the stored document and nothing else", () => {
  const base = hashes();
  const moved = (override: Record<string, string>) => {
    const next = hashes(override);
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
    ["wire"],
    "an extra RoundOverPayload field"
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
