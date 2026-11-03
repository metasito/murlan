// tests/server/judgedGone.test.ts — an instance judged gone is remembered only for the window a send
// reads it in, so a process that outlives many instance ids does not keep every one it gave up on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { judgedGone } from "../../server/store/instanceInbox.ts";

const WINDOW_MS = 10_000;

function clocked() {
  let now = 0;
  const ledger = judgedGone(WINDOW_MS, () => now);
  return { ledger, advance: (ms: number) => void (now += ms) };
}

test("an instance is gone for the window it was judged in, and not after", () => {
  const { ledger, advance } = clocked();
  ledger.judge("a");
  advance(WINDOW_MS - 1);
  assert.equal(ledger.isGone("a"), true);
  advance(1);
  assert.equal(ledger.isGone("a"), false);
});

test("one never addressed again is dropped once a later judgement finds its window over", () => {
  const { ledger, advance } = clocked();
  ledger.judge("a");
  ledger.judge("b");
  advance(WINDOW_MS / 2);
  ledger.judge("c");
  advance(WINDOW_MS / 2);
  ledger.judge("d");
  assert.equal(ledger.size, 2);
  assert.deepEqual(["a", "b", "c", "d"].map(ledger.isGone), [false, false, true, true]);
});

test("judging one again restarts its window and keeps it past older ones", () => {
  const { ledger, advance } = clocked();
  ledger.judge("a");
  ledger.judge("b");
  advance(WINDOW_MS - 1);
  ledger.judge("a");
  advance(1);
  ledger.judge("c");
  assert.equal(ledger.size, 2);
  assert.deepEqual(["a", "b", "c"].map(ledger.isGone), [true, false, true]);
});

test("one found again is forgotten at once", () => {
  const { ledger } = clocked();
  ledger.judge("a");
  ledger.forget("a");
  assert.equal(ledger.isGone("a"), false);
  assert.equal(ledger.size, 0);
});
