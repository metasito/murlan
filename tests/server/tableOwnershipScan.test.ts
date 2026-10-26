// tests/server/tableOwnershipScan.test.ts — the source scans split out of tableOwnership.test.ts so the mutation run keeps that file's behaviour tests
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { TAKEOVER } from "../../server/game/tableActions.ts";
import type { TableActionKind } from "../../server/game/tableActions.ts";
import { blankComments } from "../helpers/sourceScan.ts";

const SERVER_DIR = path.resolve(import.meta.dirname, "..", "..", "server");

function serverSource(file: string): string {
  return readFileSync(path.join(SERVER_DIR, file), "utf8");
}

/** Comments name these deliberately; only code puts a game in memory. */
function stripComments(source: string): string {
  return blankComments(source);
}

/** Every `.ts` file under `server/<dir>`, listed from the directory rather than by hand. */
function serverFiles(dir = ""): string[] {
  return readdirSync(path.join(SERVER_DIR, dir), { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ts"))
    .map((f) => path.posix.join(dir, f.split(path.sep).join("/")));
}

const GAME_ROOM_IMPORT = /import\s*\{([^}]*)\}\s*from\s*["'][^"']*\bgameRoom\.ts["']/g;
const GAME_ROOM_NAMESPACE = /import\s*\*\s*as\s+(\w+)\s+from\s*["'][^"']*\bgameRoom\.ts["']/g;

/** Patterns for what a source binds to gameRoom's `activeGames`: imported, renamed, namespaced, or held in a local. */
function tableMapNames(source: string): string[] {
  const names: string[] = [];
  for (const [, body] of source.matchAll(GAME_ROOM_IMPORT)) {
    for (const part of body.split(",")) {
      const bound = /^\s*activeGames(?:\s+as\s+(\w+))?\s*$/.exec(part);
      if (bound) names.push(bound[1] ?? "activeGames");
    }
  }
  for (const [, namespace] of source.matchAll(GAME_ROOM_NAMESPACE)) {
    if (new RegExp(`\\b${namespace}\\s*\\.\\s*activeGames\\b`).test(source)) names.push(`${namespace}\\s*\\.\\s*activeGames`);
  }
  for (const name of [...names]) {
    for (const [, local] of source.matchAll(new RegExp(`(?:const|let|var)\\s+(\\w+)\\s*=\\s*${name}\\s*;`, "g"))) {
      names.push(local);
    }
  }
  return names;
}

function tableMapWrites(source: string): string[] {
  const code = stripComments(source);
  return tableMapNames(code).flatMap((name) =>
    [
      ...code.matchAll(
        new RegExp(`(?<![\\w.])${name}\\s*(?:\\.\\s*(set|delete|clear)|\\[\\s*["'](set|delete|clear)["']\\s*\\])\\s*\\(`, "g")
      ),
    ].map((m) => m[1] ?? m[2])
  );
}

function writersOf(kinds: string[]): Record<string, number> {
  const writers: Record<string, number> = {};
  for (const file of serverFiles()) {
    const count = tableMapWrites(serverSource(file)).filter((kind) => kinds.includes(kind)).length;
    if (count > 0) writers[file] = count;
  }
  return writers;
}

describe("a game enters memory in one place, under a claim", () => {
  test("the scan recognises every kind of write", () => {
    const fromRoom = 'import { activeGames } from "./gameRoom.ts";\n';
    const writes: [string, string][] = [
      [`${fromRoom}activeGames.set(id, game);`, "set"],
      [`${fromRoom}activeGames\n    .delete(id);`, "delete"],
      [`${fromRoom}activeGames["clear"]();`, "clear"],
      ['import {\n  isShuttingDown,\n  activeGames as live,\n} from "../game/gameRoom.ts";\nlive.set(id, game);', "set"],
      [`${fromRoom}const tables = activeGames;\ntables.delete(id);`, "delete"],
      ['import * as room from "./gameRoom.ts";\nroom.activeGames.set(id, game);', "set"],
    ];
    for (const [sample, kind] of writes) assert.deepEqual(tableMapWrites(sample), [kind], sample);
    const notWrites = [
      `${fromRoom}activeGames.get(id); activeGames.has(id);`,
      `${fromRoom}// activeGames.set(id, game)`,
      'import { activeGames } from "../../shared/schema.ts";\ndb.delete(activeGames); activeGames.delete(x);',
    ];
    for (const sample of notWrites) assert.deepEqual(tableMapWrites(sample), [], sample);
  });

  test("nothing but tableLifecycle puts a game in memory: the deal and the takeover", () => {
    assert.deepEqual(
      writersOf(["set"]),
      { "game/tableLifecycle.ts": 2 },
      "startMatch and rehydrateGame are the two; any other has no claim behind it"
    );
  });

  test("nothing but gamePersistence takes a game out of memory", () => {
    assert.deepEqual(Object.keys(writersOf(["delete", "clear"])), ["game/gamePersistence.ts"]);
  });

  test("no socket or HTTP handler resolves a game from this process's map", () => {
    // `socketRoomMap` says which room a socket is at, which is local and true.
    // `activeGames` says what the game *is*, which lives in one process — and
    // reading it here is how a player on the other instance was told
    // NO_LIVE_GAME about a table they could see.
    const handlers = [...serverFiles("socket"), ...serverFiles("http")];
    assert.ok(handlers.includes("socket/socketGameplay.ts") && handlers.includes("http/routes/index.ts"));
    const readers = handlers.filter((file) => {
      const source = stripComments(serverSource(file));
      return tableMapNames(source).length > 0 || /\bactiveGames\b/.test(source);
    });
    assert.deepEqual(readers, [], "these read activeGames directly instead of asking the game layer");
  });

  test("the claim is released wherever a game leaves memory", () => {
    const source = stripComments(serverSource("game/gamePersistence.ts"));
    assert.ok(
      /activeGames\.delete[\s\S]{0,200}releaseRoom/.test(source),
      "a game dropped from memory without releasing its room leaves it unclaimable"
    );
  });
});

describe("TAKEOVER", () => {
  /** Every `kind:` in the union, read from the source so a new one cannot hide. */
  function everyKind(): TableActionKind[] {
    const source = readFileSync(path.join(SERVER_DIR, "game", "tableActions.ts"), "utf8");
    const union = source.slice(source.indexOf("export type TableAction ="));
    return [...union.matchAll(/kind: "([a-zA-Z]+)"/g)].map((m) => m[1] as TableActionKind);
  }

  test("every action says what an instance may do with an ownerless room", () => {
    const kinds = everyKind();
    assert.ok(kinds.length >= 11, `expected the whole union, got ${kinds.length}`);
    assert.deepEqual(Object.keys(TAKEOVER).sort(), [...kinds].sort());
    for (const [kind, mode] of Object.entries(TAKEOVER)) {
      assert.ok(["create", "restore", "forward"].includes(mode), `${kind} has no takeover mode`);
    }
  });
});
