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
import { ownershipKey } from "../../server/game/gameOwnership.ts";
import { TAKEOVER } from "../../server/game/tableActions.ts";
import { recordingRuntime } from "../helpers/recordingRuntime.ts";
import { onlineTable } from "../helpers/onlineTable.ts";
import { TABLE_ACTION_EVENT, applyOrForward } from "../../server/game/tableRouter.ts";
import { activeGames } from "../../server/game/gameRoom.ts";

describe("a forwarded action is applied once, however often it is sent", () => {
  // The forward is retried when its answer does not come back inside the
  // adapter's acknowledgement window, and `CLAUDE.md` is explicit that a card
  // appears exactly once — a replayed `game:pass` takes a turn twice. #544 asks
  // for the de-duplication in the same change as the retry, not after it.
  // A reaction is the action whose every application is visible: one send each.
  async function responder() {
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
