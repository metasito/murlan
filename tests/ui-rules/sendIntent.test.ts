// tests/ui-rules/sendIntent.test.ts — a move that goes nowhere says so.
//
// Socket.IO is at-most-once by its own account: "there is no guarantee that the
// other side has received it and there will be no retry upon reconnection"
// (https://socket.io/docs/v4/delivery-guarantees/). So a play emitted into a
// failing connection vanished, and all the player saw was their turn running
// out and passing itself.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { sendIntent, undelivered } from "../../lib/sendIntent.ts";

type Ack = (err: unknown, reply?: { ok: boolean; code?: string }) => void;

/**
 * A socket that answers however the script says, one entry per attempt.
 * `null` is silence: the timeout fires and `emit` reports the error, which is
 * what the real client does.
 */
function fakeSocket(script: ({ ok: boolean; code?: string } | null)[], rejoinAnswer = "game:state") {
  const sent: { event: string; args: unknown[] }[] = [];
  let attempt = 0;
  const socket = {
    once(event: string, listener: () => void) {
      if (event === rejoinAnswer) queueMicrotask(listener);
    },
    off() {},
    timeout() {
      return {
        emit(event: string, ...args: unknown[]) {
          const ack = args.pop() as Ack;
          sent.push({ event, args });
          const reply = script[attempt++];
          queueMicrotask(() => (reply ? ack(null, reply) : ack(new Error("operation has timed out"))));
        },
      };
    },
  };
  return { socket: socket as never, sent };
}

describe("sendIntent", () => {
  test("an answered intent is sent once", async () => {
    const { socket, sent } = fakeSocket([{ ok: true }]);
    assert.deepEqual(await sendIntent(socket, "game:play", { cardIds: ["a"] }), { ok: true });
    assert.equal(sent.length, 1);
  });

  test("silence is retried, and the answer that comes back is the result", async () => {
    const { socket, sent } = fakeSocket([null, { ok: true }]);
    assert.deepEqual(await sendIntent(socket, "game:pass"), { ok: true });
    assert.equal(sent.length, 2, "the second attempt is what got through");
  });

  /**
   * A refusal is an answer. Repeating something the server has already rejected
   * only delays telling the player, and would turn one illegal move into three.
   */
  test("a refusal ends it rather than being repeated", async () => {
    const { socket, sent } = fakeSocket([{ ok: false, code: "INVALID_CARD" }, { ok: true }]);
    assert.deepEqual(await sendIntent(socket, "game:play", { cardIds: ["x"] }), {
      ok: false,
      code: "INVALID_CARD",
    });
    assert.equal(sent.length, 1);
  });

  /**
   * The caller has to be able to tell "never arrived" from "arrived and was
   * refused" — one is worth telling the player about, the other is the game
   * working. Silence to the end carries no code.
   */
  test("giving up reports failure with no code, and does not hang", async () => {
    const { socket, sent } = fakeSocket([null, null, null]);
    assert.deepEqual(await sendIntent(socket, "game:play", { cardIds: ["a"] }), { ok: false });
    assert.equal(sent.length, 3, "bounded: it stops rather than retrying forever");
  });

  test("a missing socket fails rather than throwing", async () => {
    assert.deepEqual(await sendIntent(null, "game:pass"), { ok: false });
  });

  test("every attempt of one intent carries the same intentId, and a new intent a new one", async () => {
    const { socket, sent } = fakeSocket([null, { ok: true }, { ok: true }]);
    await sendIntent(socket, "game:pass");
    await sendIntent(socket, "game:pass");
    const ids = sent.map((s) => (s.args[0] as { intentId: string }).intentId);
    assert.equal(typeof ids[0], "string");
    assert.equal(ids[0], ids[1]);
    assert.notEqual(ids[1], ids[2]);
  });

  test("a socket not yet back at its table is retried, not taken as a refusal", async () => {
    const { socket, sent } = fakeSocket([{ ok: false, code: "NOT_AT_A_TABLE" }, { ok: true }]);
    assert.deepEqual(await sendIntent(socket, "game:play", { cardIds: ["a"] }), { ok: true });
    assert.equal(sent.length, 2);
  });

  test("a lobby intent is retried as soon as the lobby rejoin answers", { timeout: 1000 }, async () => {
    const { socket, sent } = fakeSocket([{ ok: false, code: "NOT_AT_A_TABLE" }, { ok: true }], "room:state");
    assert.deepEqual(await sendIntent(socket, "room:start", {}, { timeoutMs: 3000 }), { ok: true });
    assert.equal(sent.length, 2);
  });

  test("a table that stays unreachable is reported as undelivered", async () => {
    const unreachable = { ok: false, code: "TABLE_UNREACHABLE" };
    const { socket } = fakeSocket([unreachable, unreachable, unreachable]);
    const outcome = await sendIntent(socket, "game:pass");
    assert.deepEqual(outcome, unreachable);
    assert.equal(undelivered(outcome), true);
    assert.equal(undelivered({ ok: false, code: "NOT_YOUR_TURN" }), false);
  });
});
