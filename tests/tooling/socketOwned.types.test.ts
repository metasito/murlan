import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Socket } from "../../lib/socket.ts";

declare const socket: Socket;
const listener = () => {};

// Never called: `tsc` is the check. Each line reaches the raw socket's open or close by a chain, and a
// chain that hands the raw type back again turns its line into an unused directive.
export function chainedBypasses() {
  // @ts-expect-error direct
  socket.disconnect();
  // @ts-expect-error direct
  socket.connect();
  // @ts-expect-error engine
  socket.io.engine.close();
  // @ts-expect-error chained from on
  socket.on("connect", listener).disconnect();
  // @ts-expect-error chained from off
  socket.off("connect", listener).disconnect();
  // @ts-expect-error chained from once
  socket.once("connect", listener).disconnect();
  // @ts-expect-error chained from removeAllListeners
  socket.removeAllListeners().disconnect();
  // @ts-expect-error chained from onAny
  socket.onAny(listener).io.engine.close();
  // @ts-expect-error chained from volatile
  socket.volatile.disconnect();
  // @ts-expect-error chained from compress
  socket.compress(true).disconnect();
  // @ts-expect-error chained from timeout
  socket.timeout(1).disconnect();
}

test("every way into the raw socket is pinned", () => {
  const source = readFileSync(new URL(import.meta.url), "utf8");
  const pins = [...source.matchAll(/\/\/ @ts-expect-error (.+)\n\s+(socket\S*)/g)].map((m) => m[2]);
  for (const reached of ["disconnect", "connect", "engine.close", "on(", "off(", "once(", "removeAllListeners", "onAny", "volatile", "compress", "timeout"]) {
    assert.ok(pins.some((line) => line.includes(reached)), `nothing pins ${reached}`);
  }
});
