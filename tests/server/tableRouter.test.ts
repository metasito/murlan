// How an action finds its table: answered from memory, forwarded to the instance holding it, and applied once.
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { applyOrForward, forgetAppliedIntents, TABLE_ACTION_EVENT } from "../../server/game/tableRouter.ts";
import { activeGames } from "../../server/game/gameRoom.ts";
import { installClock } from "../../server/http/clock.ts";
import type { TableActionDraft } from "../../server/game/tableActions.ts";
import { fakeClock } from "../helpers/fakeClock.ts";
import { onlineTable } from "../helpers/onlineTable.ts";
import { recordingRuntime } from "../helpers/recordingRuntime.ts";
import type { OnlineGameState } from "../../server/game/gameRoom.ts";

const ROOM = "table-router-room";

afterEach(() => {
  activeGames.delete(ROOM);
  forgetAppliedIntents();
});

const reaction = (userId: string, intentId?: string): TableActionDraft =>
  ({ kind: "reaction", roomId: ROOM, userId, emoji: "👍", intentId }) as TableActionDraft;

function hold(over: Partial<OnlineGameState> = {}) {
  const game = onlineTable({
    roomId: ROOM,
    playerMap: { 0: "ana", 1: "besi" },
    gameState: { players: [{ name: "Ana" }, { name: "Besi" }] } as never,
    ...over,
  });
  activeGames.set(ROOM, game);
  return game;
}

const reactions = (sent: ReturnType<typeof recordingRuntime>["sent"]) =>
  sent.filter((e) => e.event === "game:reaction").length;

describe("a client's retry of an action", () => {
  test("is applied once, as long as it carries the same intent from the same player", async () => {
    const { rt, sent } = recordingRuntime();
    hold();
    assert.deepEqual(await applyOrForward(rt, reaction("ana", "i1")), { ok: true });
    assert.deepEqual(await applyOrForward(rt, reaction("ana", "i1")), { ok: true });
    assert.equal(reactions(sent), 1);
  });

  test("is not mistaken for another player's action that carries the same intent", async () => {
    const { rt, sent } = recordingRuntime();
    hold();
    await applyOrForward(rt, reaction("ana", "i1"));
    await applyOrForward(rt, reaction("besi", "i1"));
    assert.equal(reactions(sent), 2);
  });

  test("an action with no intent is always new", async () => {
    const { rt, sent } = recordingRuntime();
    hold();
    await applyOrForward(rt, reaction("ana"));
    await applyOrForward(rt, reaction("ana"));
    assert.equal(reactions(sent), 2);
  });

  test("is answered from the record for a minute, then applied again", async (t) => {
    const clock = fakeClock();
    t.after(installClock(clock));
    const { rt, sent } = recordingRuntime();
    hold();
    await applyOrForward(rt, reaction("ana", "i1"));
    clock.advance(60_000);
    await applyOrForward(rt, reaction("ana", "i1"));
    assert.equal(reactions(sent), 1, "forgotten at exactly the minute");
    clock.advance(1);
    await applyOrForward(rt, reaction("ana", "i1"));
    assert.equal(reactions(sent), 2, "still remembered past the minute");
  });

  test("whose first attempt failed is applied afresh, not answered with the failure", async () => {
    const { rt, sent } = recordingRuntime();
    const game = hold({ gameState: undefined as never });
    await assert.rejects(applyOrForward(rt, reaction("ana", "i1")));
    game.gameState = { players: [{ name: "Ana" }] } as never;
    assert.deepEqual(await applyOrForward(rt, reaction("ana", "i1")), { ok: true });
    assert.equal(reactions(sent), 1);
  });

  test("the record is bounded: the oldest intent is the first forgotten", async () => {
    const { rt, sent } = recordingRuntime();
    hold();
    for (let i = 0; i <= 2000; i++) await applyOrForward(rt, reaction("ana", `n${i}`));
    assert.equal(reactions(sent), 2001);
    await applyOrForward(rt, reaction("ana", "n1"));
    assert.equal(reactions(sent), 2001, "a recent intent was forgotten");
    await applyOrForward(rt, reaction("ana", "n0"));
    assert.equal(reactions(sent), 2002, "the record grew past its bound");
  });
});

describe("an action for a table this instance holds", () => {
  test("is applied here without asking the cluster", async () => {
    let asked = 0;
    const { rt, sent } = recordingRuntime({
      transport: {
        serverSideEmit: () => {
          asked++;
          return true;
        },
      },
    });
    hold();
    await applyOrForward(rt, reaction("ana"));
    assert.equal(asked, 0);
    assert.equal(reactions(sent), 1);
  });
});

describe("an action for a table another instance may hold", () => {
  const replies = (answers: unknown[], err: unknown = null) => ({
    serverSideEmit: (_event: string, _action: unknown, ack: (e: unknown, r: unknown[]) => void) => {
      ack(err, answers);
      return true;
    },
  });
  const disowned = { ok: false, code: "NOT_THIS_INSTANCE" };

  test("is answered by the owner, however many instances disowned it", async () => {
    const { rt } = recordingRuntime({
      transport: replies([disowned, { ok: false, code: "NOT_SEATED" }, disowned]),
    });
    assert.deepEqual(await applyOrForward(rt, reaction("ana")), { ok: false, code: "NOT_SEATED" });
  });

  test("sends the owner the action as the player gave it, stamped with an id", async () => {
    const seen: unknown[] = [];
    const { rt } = recordingRuntime({
      transport: {
        serverSideEmit: (event: string, action: unknown, ack: (e: unknown, r: unknown[]) => void) => {
          seen.push([event, action]);
          ack(null, [{ ok: true }]);
          return true;
        },
      },
    });
    await applyOrForward(rt, reaction("ana", "i9"));
    assert.deepEqual(seen, [
      ["murlan:table", { kind: "reaction", roomId: ROOM, userId: "ana", emoji: "👍", id: "ana:i9" }],
    ]);
  });

  test("when every instance disowns a forwarded action, there is no game", async () => {
    const { rt } = recordingRuntime({ transport: replies([disowned, disowned]) });
    assert.deepEqual(await applyOrForward(rt, reaction("ana")), { ok: false, code: "NO_LIVE_GAME" });
  });

  test("when no instance exists besides this one, a forwarded action finds no game", async () => {
    const { rt } = recordingRuntime({ transport: replies([]) });
    assert.deepEqual(await applyOrForward(rt, reaction("ana")), { ok: false, code: "NO_LIVE_GAME" });
  });

  test("a peer that answers with nothing is an owner that does not know the kind", async () => {
    const { rt } = recordingRuntime({ transport: replies([disowned, undefined]) });
    assert.deepEqual(await applyOrForward(rt, reaction("ana")), { ok: false, code: "UNKNOWN_ACTION" });
  });

  test("an acknowledgement with no replies at all means no instance holds the table", async () => {
    const { rt } = recordingRuntime({
      transport: {
        serverSideEmit: (_e: string, _a: unknown, ack: (e: unknown) => void) => {
          ack(null);
          return true;
        },
      },
    });
    assert.deepEqual(await applyOrForward(rt, reaction("ana")), { ok: false, code: "NO_LIVE_GAME" });
  });

  test("an owner's answer outweighs a peer that failed to answer", async () => {
    const { rt } = recordingRuntime({ transport: replies([{ ok: true }], new Error("timeout")) });
    assert.deepEqual(await applyOrForward(rt, reaction("ana")), { ok: true });
  });
});

describe("the listener for actions other instances forward", () => {
  function listener(over: Record<string, unknown> = {}) {
    let receive!: (action: unknown, reply?: unknown) => void;
    const { sent } = recordingRuntime({
      transport: {
        on: (event: string, fn: typeof receive) => {
          if (event === TABLE_ACTION_EVENT) receive = fn;
        },
        ...over,
      },
    });
    const ask = (action: unknown) => new Promise((resolve) => receive(action, resolve));
    return { receive, ask, sent };
  }
  const wire = { id: "w1", kind: "reaction", roomId: ROOM, userId: "ana", emoji: "👍" };

  test("ignores an emit that wants no answer, and applies nothing", async () => {
    const { receive, sent } = listener();
    hold();
    assert.doesNotThrow(() => receive(wire));
    await new Promise((r) => setImmediate(r));
    assert.equal(reactions(sent), 0);
  });

  test("answers with the table's own outcome for a room it holds", async () => {
    const { ask, sent } = listener();
    hold();
    assert.deepEqual(await ask(wire), { ok: true });
    assert.equal(reactions(sent), 1);
    assert.deepEqual(await ask({ ...wire, id: "w2", userId: "stranger" }), { ok: false, code: "NOT_SEATED" });
  });

  test("answers a server error when applying throws, so the asker is not left waiting", async () => {
    const { ask } = listener();
    hold({ gameState: undefined as never });
    assert.deepEqual(await ask(wire), { ok: false, code: "SERVER_ERROR" });
  });
});
