// tests/tableOwnership.test.ts — one instance owns a table, and the code says so.
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
import { ownershipKey } from "../server/gameOwnership.ts";
import { takeoverMode } from "../server/tableActions.ts";
import type { TableActionKind } from "../server/tableActions.ts";

const SERVER_DIR = path.resolve(import.meta.dirname, "..", "server");

function serverSource(file: string): string {
  return readFileSync(path.join(SERVER_DIR, file), "utf8");
}

/** Comments name these deliberately; only code puts a game in memory. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("a game enters memory in one place, under a claim", () => {
  test("nothing but tableHandlers writes activeGames", () => {
    const writers = readdirSync(SERVER_DIR)
      .filter((f) => f.endsWith(".ts"))
      .filter((f) => /\bactiveGames\.set\s*\(/.test(stripComments(serverSource(f))));
    assert.deepEqual(
      writers,
      ["tableHandlers.ts"],
      "a game put in memory outside the claimed paths is a second owner waiting to happen"
    );
  });

  test("the two writers are the deal and the takeover, and nothing else", () => {
    const source = stripComments(serverSource("tableHandlers.ts"));
    assert.equal(
      [...source.matchAll(/\bactiveGames\.set\s*\(/g)].length,
      2,
      "startMatch and rehydrateGame are the two; a third has no claim behind it"
    );
  });

  test("the handler families do not resolve a game from this process's map", () => {
    // `socketRoomMap` says which room a socket is at, which is local and true.
    // `activeGames` says what the game *is*, which lives in one process — and
    // reading it here is how a player on the other instance was told
    // NO_LIVE_GAME about a table they could see.
    for (const file of ["socketGameplay.ts", "socketRooms.ts"]) {
      assert.ok(
        !/\bactiveGames\b/.test(stripComments(serverSource(file))),
        `${file} reads activeGames directly instead of routing to the owner`
      );
    }
  });

  test("the claim is released wherever a game leaves memory", () => {
    const source = stripComments(serverSource("gamePersistence.ts"));
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
  async function respondTwice(ids: [string, string]): Promise<number> {
    const { activeGames } = await import("../server/gameRoom.ts");
    const { TABLE_ACTION_EVENT, registerTableRouting, setTableHandlers } = await import(
      "../server/tableRouter.ts"
    );

    let applied = 0;
    setTableHandlers(
      async () => {
        applied += 1;
        return { ok: true };
      },
      async () => "missing"
    );

    let receive: ((action: unknown, reply: (r: unknown) => void) => void) | undefined;
    registerTableRouting({
      on: (event: string, fn: typeof receive) => {
        if (event === TABLE_ACTION_EVENT) receive = fn;
      },
    } as never);
    assert.ok(receive, "the router registered no listener for forwarded actions");

    const roomId = `dedupe-${ids.join("-")}`;
    // The responder only asks whether this process holds the room.
    activeGames.set(roomId, {} as never);
    try {
      for (const id of ids) {
        await new Promise((resolve) =>
          receive!({ id, kind: "pass", roomId, userId: "u", username: "u" }, resolve)
        );
      }
    } finally {
      activeGames.delete(roomId);
    }
    return applied;
  }

  test("the same action arriving twice is applied once", async () => {
    assert.equal(await respondTwice(["one", "one"]), 1);
  });

  test("two different actions are both applied", async () => {
    assert.equal(await respondTwice(["two", "three"]), 2);
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

describe("takeoverMode", () => {
  /** Every `kind:` in the union, read from the source so a new one cannot hide. */
  function everyKind(): TableActionKind[] {
    const source = readFileSync(path.join(SERVER_DIR, "tableActions.ts"), "utf8");
    const union = source.slice(source.indexOf("export type TableAction ="));
    return [...union.matchAll(/kind: "([a-zA-Z]+)"/g)].map((m) => m[1] as TableActionKind);
  }

  test("every action says what an instance may do with an ownerless room", () => {
    const kinds = everyKind();
    assert.ok(kinds.length >= 12, `expected the whole union, got ${kinds.length}`);
    for (const kind of kinds) {
      assert.ok(
        ["create", "restore", "forward"].includes(takeoverMode(kind)),
        `${kind} has no takeover mode`
      );
    }
  });

  test("only starting a match may bring a table into being", () => {
    const creating = everyKind().filter((k) => takeoverMode(k) === "create");
    assert.deepEqual(creating, ["startMatch"]);
  });

  test("the actions a player is waiting on take a dead owner's table over", () => {
    // A move that answered "no live game" because the instance holding the hand
    // had gone is the whole of #570's second half. Reviving a table to hand one
    // seat to a bot is not: that sets the hand playing itself with nobody there.
    for (const kind of ["play", "pass", "exchange", "rejoin"] as const) {
      assert.equal(takeoverMode(kind), "restore", `${kind} must be able to take a table over`);
    }
    for (const kind of ["seatLost", "vacate", "reaction", "spectate"] as const) {
      assert.equal(takeoverMode(kind), "forward", `${kind} must not revive a stranded hand`);
    }
  });
});
