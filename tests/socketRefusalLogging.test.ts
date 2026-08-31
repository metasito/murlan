// tests/socketRefusalLogging.test.ts — every way `onEvent` turns an intent away
// has to leave a line in the server log.
//
// #603 is the shape this pins: a soak run counted seven refusals reaching its
// clients and the server log for the same run held nothing at all, so "the
// server refused it" and "the server never heard it" were the same silence and
// the cause had to be reached by elimination. The refusal the run had hit —
// `RATE_LIMITED` — was the one branch in the wrapper that emitted and returned
// without logging, and a handler that answers `ok: false` on its own still logs
// nothing unless it remembers to.
//
// The assertions are on the wrapper rather than on any one event, because the
// silence belongs to the boundary: an event added tomorrow with a limit on it
// inherits whichever answer this file pins.
import { test, describe, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { onEvent, __resetRateLimits } from "../server/socketSafety.ts";
import { logger } from "../server/logger.ts";

interface Recorded {
  level: string;
  fields: Record<string, unknown>;
  message: string;
}

/** The socket surface `onEvent` touches, plus a record of what it emitted. */
function fakeSocket(userId = "u1") {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const emitted: { event: string; payload: any }[] = [];
  return {
    data: { userId },
    on(event: string, cb: (...args: unknown[]) => void) {
      handlers.set(event, cb);
    },
    emit(event: string, payload: unknown) {
      emitted.push({ event, payload });
    },
    /** Delivers a packet the way socket.io would, and waits for the handler. */
    async send(event: string, payload?: unknown) {
      const replies: any[] = [];
      handlers.get(event)!(payload, (reply: unknown) => replies.push(reply));
      // The wrapper runs its body in a detached async IIFE, so the answer is
      // never ready in the same tick the packet arrives in.
      await new Promise((r) => setImmediate(r));
      return replies[0];
    },
    emitted,
  };
}

const Payload = z.object({ roomId: z.string().min(1) });

describe("onEvent leaves every refusal in the log", () => {
  let lines: Recorded[];

  beforeEach(() => {
    __resetRateLimits();
    lines = [];
    for (const level of ["warn", "error", "info"] as const) {
      mock.method(logger, level, (fields: any, message?: string) => {
        lines.push({
          level,
          fields: typeof fields === "object" && fields !== null ? fields : {},
          message: typeof fields === "string" ? fields : (message ?? ""),
        });
      });
    }
  });

  afterEach(() => mock.restoreAll());

  test("a rate-limited packet is named in the log", async () => {
    const socket = fakeSocket();
    onEvent(socket as any, "game:play", Payload, async () => undefined, {
      limit: 1,
      windowMs: 60_000,
    });

    assert.deepEqual(await socket.send("game:play", { roomId: "r1" }), { ok: true });
    assert.deepEqual(await socket.send("game:play", { roomId: "r1" }), {
      ok: false,
      code: "RATE_LIMITED",
    });

    const refusal = lines.find((l) => l.fields.code === "RATE_LIMITED");
    assert.ok(refusal, "a rate-limited packet reached the log as nothing at all");
    assert.equal(refusal.fields.event, "game:play");
    assert.equal(refusal.fields.userId, "u1");
  });

  test("a flood is recorded once, not once per packet", async () => {
    // The limiter exists to make excess cheap. A line per rejected packet
    // would hand whoever is flooding a disk-filling primitive for free.
    const socket = fakeSocket();
    onEvent(socket as any, "game:play", Payload, async () => undefined, {
      limit: 1,
      windowMs: 60_000,
    });

    for (let i = 0; i < 200; i++) await socket.send("game:play", { roomId: "r1" });

    assert.equal(
      lines.filter((l) => l.fields.code === "RATE_LIMITED").length,
      1,
      "199 rejected packets in one window wrote more than one line"
    );
    assert.equal(socket.emitted.filter((e) => e.event === "game:error").length, 199);
  });

  test("the next window is recorded again — a throttle is not a mute", async () => {
    const socket = fakeSocket();
    // Wide enough that both packets of a pair land in the same window even on
    // a loaded machine: a window this test outran would count three.
    onEvent(socket as any, "game:play", Payload, async () => undefined, {
      limit: 1,
      windowMs: 200,
    });

    await socket.send("game:play", { roomId: "r1" });
    await socket.send("game:play", { roomId: "r1" });
    await new Promise((r) => setTimeout(r, 250));
    await socket.send("game:play", { roomId: "r1" });
    await socket.send("game:play", { roomId: "r1" });

    assert.equal(lines.filter((l) => l.fields.code === "RATE_LIMITED").length, 2);
  });

  test("a refusal the handler itself returns is named in the log", async () => {
    const socket = fakeSocket();
    onEvent(socket as any, "game:play", Payload, async () => ({
      ok: false,
      code: "NOT_AT_A_TABLE",
    }));

    assert.deepEqual(await socket.send("game:play", { roomId: "r1" }), {
      ok: false,
      code: "NOT_AT_A_TABLE",
    });

    const refusal = lines.find((l) => l.fields.code === "NOT_AT_A_TABLE");
    assert.ok(refusal, "a handler's own refusal reached the log as nothing at all");
    assert.equal(refusal.fields.event, "game:play");
  });

  test("a malformed packet is named in the log", async () => {
    const socket = fakeSocket();
    onEvent(socket as any, "game:play", Payload, async () => undefined);

    assert.deepEqual(await socket.send("game:play", { roomId: "" }), {
      ok: false,
      code: "INVALID_PAYLOAD",
    });

    const refusal = lines.find((l) => l.fields.code === "INVALID_PAYLOAD");
    assert.ok(refusal, "a malformed packet reached the log as nothing at all");
    assert.equal(refusal.fields.event, "game:play");
  });

  test("a throwing handler is named in the log", async () => {
    const socket = fakeSocket();
    onEvent(socket as any, "game:play", Payload, async () => {
      throw new Error("boom");
    });

    assert.deepEqual(await socket.send("game:play", { roomId: "r1" }), {
      ok: false,
      code: "SERVER_ERROR",
    });

    const refusal = lines.find((l) => l.fields.code === "SERVER_ERROR");
    assert.ok(refusal, "a throwing handler reached the log as nothing at all");
    assert.equal(refusal.level, "error", "a contained throw is not a routine refusal");
    assert.ok(refusal.fields.err, "the throw itself is what makes this one diagnosable");
  });

  test("the refusal carries what the packet asked for, so the log can be read alone", async () => {
    const socket = fakeSocket();
    onEvent(socket as any, "game:rejoin", Payload, async () => ({
      ok: false,
      code: "UNAUTHORIZED",
    }));

    await socket.send("game:rejoin", { roomId: "table-7" });

    const refusal = lines.find((l) => l.fields.code === "UNAUTHORIZED");
    assert.ok(refusal);
    assert.deepEqual(
      refusal.fields.payload,
      { roomId: "table-7" },
      "which table was refused is the first thing anyone reading this asks"
    );
  });

  test("an accepted packet says nothing — a log of every move is a log nobody reads", async () => {
    const socket = fakeSocket();
    onEvent(socket as any, "game:play", Payload, async () => undefined, {
      limit: 10,
      windowMs: 60_000,
    });

    assert.deepEqual(await socket.send("game:play", { roomId: "r1" }), { ok: true });
    assert.deepEqual(lines, []);
  });
});
