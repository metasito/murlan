import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { blankCommentsAndStrings, sourcesUnder } from "../helpers/sourceScan.ts";
import { registerStopSpectating, stopSpectatingEverywhere } from "../../server/socket/seating.ts";
import { spectatorRoomMap, userRoom } from "../../server/game/gameRoom.ts";
import type { InstanceHandler } from "../../server/store/instanceInbox.ts";
import { recordingRuntime } from "../helpers/recordingRuntime.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("a socket takes a seat only through seatSocket", () => {
  const writers = sourcesUnder(repoRoot, ["server"])
    .filter(([, src]) => /\bsocketRoomMap\.set\(/.test(blankCommentsAndStrings(src)))
    .map(([file]) => file);
  assert.deepEqual(writers, ["server/socket/seating.ts"]);
});

test("stopping a player spectating everywhere sends one message, to their instance alone", async () => {
  const sent: [string, unknown][] = [];
  const { rt } = recordingRuntime({
    peers: {
      instanceOf: async (userId) => (userId === "u1" ? "their-instance" : null),
      speaksInbox: () => true,
      send: async (to, message) => void sent.push([to, message]),
    },
  });
  await stopSpectatingEverywhere(rt, "u1");
  assert.deepEqual(sent, [["their-instance", { kind: "stop-spectating", userId: "u1" }]]);
});

test("stopping a player spectating everywhere sends nothing for an account here or offline", async () => {
  const sent: unknown[] = [];
  const { rt } = recordingRuntime({
    peers: {
      instanceOf: async (userId) => (userId === "here" ? "this-instance" : null),
      send: async (to) => void sent.push(to),
    },
  });
  await stopSpectatingEverywhere(rt, "here");
  await stopSpectatingEverywhere(rt, "offline");
  assert.deepEqual(sent, []);
});

/** Whether `stopSpectatingEverywhere` has settled once its pending work has run and `ms` of frozen time passed. */
async function settledAfter(t: TestContext, stopping: Promise<void>, ms: number): Promise<boolean> {
  let settled = false;
  void stopping.then(() => (settled = true));
  const flush = async () => {
    for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
  };
  await flush();
  if (ms > 0) t.mock.timers.tick(ms);
  await flush();
  return settled;
}

test("stopping a player spectating everywhere waits on no peer's answer", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { rt } = recordingRuntime({
    peers: { instanceOf: async () => "silent-instance", speaksInbox: () => true, send: async () => {} },
  });
  assert.equal(await settledAfter(t, stopSpectatingEverywhere(rt, "u1"), 0), true);
});

test("stopping a player spectating everywhere is held up by an unanswered store for one try at most", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { rt } = recordingRuntime({ peers: { instanceOf: () => new Promise(() => {}) } });
  const stopping = stopSpectatingEverywhere(rt, "u1");
  assert.equal(await settledAfter(t, stopping, 1_499), false);
  assert.equal(await settledAfter(t, stopping, 1), true);
});

test("an instance told an account stopped watching takes its sockets here out of the watched room", async (t) => {
  const handlers = new Map<string, InstanceHandler>();
  const left: string[] = [];
  const socket = { id: "s1", leave: (room: string) => void left.push(room) };
  const { rt } = recordingRuntime({
    peers: { on: (kind, handler) => void handlers.set(kind, handler) },
    transport: {
      sockets: { adapter: { rooms: new Map([[userRoom("u1"), new Set(["s1"])]]) }, sockets: new Map([["s1", socket]]) },
    },
  });
  const routed: unknown[] = [];
  t.mock.method(rt, "route", async (draft: unknown) => (routed.push(draft), { ok: true }));
  registerStopSpectating(rt);
  spectatorRoomMap.set("s1", "watched-room");
  try {
    await handlers.get("stop-spectating")?.({ kind: "stop-spectating", userId: "u1" });
    assert.equal(spectatorRoomMap.has("s1"), false);
    assert.deepEqual(left, ["watched-room"]);
    assert.deepEqual(routed, [{ kind: "unspectate", roomId: "watched-room", userId: "u1" }]);
  } finally {
    spectatorRoomMap.delete("s1");
  }
});

test("stopping a player spectating at an instance on an older revision goes over the legacy emit", async () => {
  const emitted: unknown[] = [];
  const sent: unknown[] = [];
  const { rt } = recordingRuntime({
    peers: {
      instanceOf: async () => "old-instance",
      speaksInbox: () => false,
      send: async (to) => void sent.push(to),
      legacy: {
        ask: async (event, payload) => (emitted.push([event, payload]), { err: null, replies: [] }),
        answer: () => {},
      },
    },
  });
  await stopSpectatingEverywhere(rt, "u1");
  assert.deepEqual(emitted, [["murlan:stop-spectating", "u1"]]);
  assert.deepEqual(sent, []);
});

test("an older instance's legacy call to stop an account watching is answered once its sockets here left", async (t) => {
  const answers = new Map<string, (payload: unknown) => Promise<unknown>>();
  const left: string[] = [];
  const socket = { id: "s2", leave: (room: string) => void left.push(room) };
  const { rt } = recordingRuntime({
    peers: { legacy: { ask: async () => ({ err: null, replies: [] }), answer: (event, handler) => void answers.set(event, handler) } },
    transport: {
      sockets: { adapter: { rooms: new Map([[userRoom("u2"), new Set(["s2"])]]) }, sockets: new Map([["s2", socket]]) },
    },
  });
  t.mock.method(rt, "route", async () => ({ ok: true }));
  registerStopSpectating(rt);
  spectatorRoomMap.set("s2", "watched-room");
  try {
    await answers.get("murlan:stop-spectating")?.("u2");
    assert.deepEqual(left, ["watched-room"]);
  } finally {
    spectatorRoomMap.delete("s2");
  }
});
