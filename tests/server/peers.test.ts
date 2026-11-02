// The carrier an instance on a revision before inbox routing speaks, as `instancePeers` gives it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { instancePeers } from "../../server/socket/peers.ts";
import { stubTransport } from "../helpers/recordingRuntime.ts";

test("a legacy ask resolves with every instance's acknowledgement, error included", async () => {
  const emitted: unknown[] = [];
  const timeout = new Error("timeout");
  const peers = instancePeers(
    stubTransport({
      serverSideEmit: (event: string, payload: unknown, ack: (err: unknown, replies: unknown[]) => void) => {
        emitted.push([event, payload]);
        ack(timeout, [{ ok: true }]);
        return true;
      },
    })
  );
  assert.deepEqual(await peers.legacy.ask("murlan:table", { id: "a" }), { err: timeout, replies: [{ ok: true }] });
  assert.deepEqual(emitted, [["murlan:table", { id: "a" }]]);
});

test("a legacy answer acknowledges what the handler settles on, and a server error when it throws", async () => {
  const listeners = new Map<string, (payload: unknown, reply?: (answer: unknown) => void) => void>();
  const peers = instancePeers(stubTransport({ on: (event: string, fn: never) => void listeners.set(event, fn) }));
  peers.legacy.answer("murlan:table", async (payload) => {
    if (payload === "boom") throw new Error("boom");
    return { ok: true, payload };
  });
  const ask = (payload: unknown) => new Promise((resolve) => listeners.get("murlan:table")!(payload, resolve));
  assert.deepEqual(await ask("x"), { ok: true, payload: "x" });
  assert.deepEqual(await ask("boom"), { ok: false, code: "SERVER_ERROR" });
  assert.doesNotThrow(() => listeners.get("murlan:table")!("no ack wanted"));
});
