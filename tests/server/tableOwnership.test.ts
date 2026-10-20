// tests/server/tableOwnership.test.ts — one instance owns a table, and the code says so.
//
// The defect this pins is not a wrong answer, it is a second copy: two
// instances each holding a game for one room, each broadcasting its own state
// and each persisting over the other. Nothing about that fails loudly, so what
// keeps it away is structural — a game only ever enters memory under a claim,
// and no handler resolves one out of `activeGames` where the socket happens to
// be.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { ownershipKey } from "../../server/game/gameOwnership.ts";
import { TAKEOVER } from "../../server/game/tableActions.ts";
import type { TableActionKind } from "../../server/game/tableActions.ts";
import { recordingRuntime } from "../helpers/recordingRuntime.ts";
import { onlineTable } from "../helpers/onlineTable.ts";

const SERVER_DIR = path.resolve(import.meta.dirname, "..", "..", "server");

function serverSource(file: string): string {
  return readFileSync(path.join(SERVER_DIR, file), "utf8");
}

/** Comments name these deliberately; only code puts a game in memory. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** Every `.ts` file under `server/<dir>`, listed from the directory rather than by hand. */
function serverFiles(dir = ""): string[] {
  return readdirSync(path.join(SERVER_DIR, dir), { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ts"))
    .map((f) => path.posix.join(dir, f.split(path.sep).join("/")));
}

const GAME_ROOM_IMPORT = /import\s*\{([^}]*)\}\s*from\s*["'][^"']*\bgameRoom\.ts["']/g;

/** The names a source binds to gameRoom's `activeGames`: imported, renamed, or held in a local. */
function tableMapNames(source: string): string[] {
  const names: string[] = [];
  for (const [, body] of source.matchAll(GAME_ROOM_IMPORT)) {
    for (const part of body.split(",")) {
      const bound = /^\s*activeGames(?:\s+as\s+(\w+))?\s*$/.exec(part);
      if (bound) names.push(bound[1] ?? "activeGames");
    }
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

describe("a forwarded action is applied once, however often it is sent", () => {
  // The forward is retried when its answer does not come back inside the
  // adapter's acknowledgement window, and `CLAUDE.md` is explicit that a card
  // appears exactly once — a replayed `game:pass` takes a turn twice. #544 asks
  // for the de-duplication in the same change as the retry, not after it.
  // A reaction is the action whose every application is visible: one send each.
  async function responder() {
    const { TABLE_ACTION_EVENT } = await import("../../server/game/tableRouter.ts");
    let receive: ((action: unknown, reply: (r: unknown) => void) => void) | undefined;
    const { sent } = recordingRuntime({
      transport: {
        on: (event: string, fn: typeof receive) => {
          if (event === TABLE_ACTION_EVENT) receive = fn;
        },
      },
    });
    assert.ok(receive, "the router registered no listener for forwarded actions");
    const counter = {
      get applied() {
        return sent.filter((e) => e.event === "game:reaction").length;
      },
    };
    return { receive, counter };
  }

  async function respondTwice(ids: [string, string]): Promise<number> {
    const { activeGames } = await import("../../server/game/gameRoom.ts");
    const { receive, counter } = await responder();

    const roomId = `dedupe-${ids.join("-")}`;
    activeGames.set(
      roomId,
      onlineTable({ roomId, playerMap: { 0: "u" }, gameState: { players: [{ name: "U" }] } as never })
    );
    try {
      for (const id of ids) {
        await new Promise((resolve) =>
          receive({ id, kind: "reaction", emoji: "👍", roomId, userId: "u" }, resolve)
        );
      }
    } finally {
      activeGames.delete(roomId);
    }
    return counter.applied;
  }

  test("an instance that does not hold the room disowns it and applies nothing", async () => {
    const { receive, counter } = await responder();
    const reply = await new Promise((resolve) =>
      receive({ id: "stray", kind: "reaction", emoji: "👍", roomId: "held-elsewhere", userId: "u" }, resolve)
    );
    assert.deepEqual(reply, { ok: false, code: "NOT_THIS_INSTANCE" });
    assert.equal(counter.applied, 0);
  });

  test("the same action arriving twice is applied once", async () => {
    assert.equal(await respondTwice(["one", "one"]), 1);
  });

  test("two different actions are both applied", async () => {
    assert.equal(await respondTwice(["two", "three"]), 2);
  });
});

describe("an action kind the owner does not know", () => {
  const future = (roomId: string) => ({ kind: "future", roomId, userId: "u", username: "u" }) as never;

  test("is refused with a code by an owner that holds the room", async () => {
    const { applyOrForward } = await import("../../server/game/tableRouter.ts");
    const { activeGames } = await import("../../server/game/gameRoom.ts");
    activeGames.set("future-owned", {} as never);
    try {
      assert.deepEqual(await applyOrForward(recordingRuntime().rt, future("future-owned")), {
        ok: false,
        code: "UNKNOWN_ACTION",
      });
    } finally {
      activeGames.delete("future-owned");
    }
  });

  test("is a refusal, not a missing owner, when an older owner answers with nothing", async () => {
    const { applyOrForward } = await import("../../server/game/tableRouter.ts");
    const { rt } = recordingRuntime({
      transport: {
        serverSideEmit: (_e: string, _a: unknown, ack: (err: unknown, replies: unknown[]) => void) =>
          ack(null, [{ ok: false, code: "NOT_THIS_INSTANCE" }, undefined]),
      },
    });
    assert.deepEqual(await applyOrForward(rt, future("future-elsewhere")), {
      ok: false,
      code: "UNKNOWN_ACTION",
    });
  });
});

describe("ownershipKey", () => {
  test("is stable, and fits the bigint pg_try_advisory_lock takes", () => {
    const key = ownershipKey("11111111-2222-3333-4444-555555555555");
    assert.equal(key, ownershipKey("11111111-2222-3333-4444-555555555555"));
    const asBigInt = BigInt(key);
    assert.ok(asBigInt >= -(2n ** 63n) && asBigInt < 2n ** 63n);
  });

  test("two rooms do not share a lock", () => {
    const keys = new Set(
      Array.from({ length: 500 }, (_, i) => ownershipKey(`room-${i}`))
    );
    assert.equal(keys.size, 500);
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

  test("only starting a match may bring a table into being", () => {
    const creating = Object.entries(TAKEOVER).flatMap(([kind, mode]) => (mode === "create" ? [kind] : []));
    assert.deepEqual(creating, ["startMatch"]);
  });

  test("the actions a player is waiting on take a dead owner's table over", () => {
    // A move that answered "no live game" because the instance holding the round
    // had gone is the whole of #570's second half. Reviving a table to hand one
    // seat to a bot is not: that sets the round playing itself with nobody there.
    for (const kind of ["move", "rejoin"] as const) {
      assert.equal(TAKEOVER[kind], "restore", `${kind} must be able to take a table over`);
    }
    for (const kind of ["seatLost", "vacate", "reaction", "spectate"] as const) {
      assert.equal(TAKEOVER[kind], "forward", `${kind} must not revive a stranded round`);
    }
  });
});
