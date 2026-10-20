// One countdown for the turn chip, the seat ring and the reconnect mark: how a window runs, holds and ends.
import { test } from "node:test";
import assert from "node:assert/strict";
import { countdownStep, remainingMs, type Countdown } from "../../components/table/countdown.ts";

const TOTAL = 30_000;
const at = (c: Countdown, key: string, running: boolean, now: number) => countdownStep(c, { key, running, now, totalMs: TOTAL });
const fresh = countdownStep(undefined, { key: "a", running: true, now: 0, totalMs: TOTAL });

test("countdownStep, step by step", () => {
  const rows: { name: string; steps: [key: string, running: boolean, now: number][]; now: number; remaining: number; expired: boolean }[] = [
    { name: "runs from its key's start", steps: [], now: 5_500, remaining: 24_500, expired: false },
    { name: "a hold freezes what has run", steps: [["a", false, 5_500]], now: 15_500, remaining: 24_500, expired: false },
    { name: "a resume runs on from the hold, to the millisecond", steps: [["a", false, 5_500], ["a", true, 15_500]], now: 16_100, remaining: 23_900, expired: false },
    { name: "a repeated hold adds nothing", steps: [["a", false, 5_500], ["a", false, 9_000]], now: 20_000, remaining: 24_500, expired: false },
    { name: "a repeated run keeps its start", steps: [["a", true, 3_000]], now: 4_000, remaining: 26_000, expired: false },
    { name: "a new key starts a full window", steps: [["b", true, 12_000]], now: 12_000, remaining: TOTAL, expired: false },
    { name: "a new key arriving held waits at full", steps: [["b", false, 12_000]], now: 20_000, remaining: TOTAL, expired: false },
    { name: "a running window ends at its total", steps: [["a", true, TOTAL]], now: TOTAL, remaining: 0, expired: true },
    { name: "a held window never ends", steps: [["a", false, 1_000], ["a", false, TOTAL * 3]], now: TOTAL * 3, remaining: TOTAL - 1_000, expired: false },
    { name: "an ended window stays ended through a hold and a resume", steps: [["a", true, TOTAL + 50], ["a", false, TOTAL + 60], ["a", true, TOTAL + 70]], now: TOTAL + 80, remaining: 0, expired: true },
    { name: "an ended window's key restarting runs again", steps: [["a", true, TOTAL + 50], ["c", true, TOTAL + 60]], now: TOTAL + 1_060, remaining: TOTAL - 1_000, expired: false },
  ];
  for (const row of rows) {
    const c = row.steps.reduce((s, [key, running, now]) => at(s, key, running, now), fresh);
    assert.equal(remainingMs(c, row.now), row.remaining, row.name);
    assert.equal(c.expired, row.expired, row.name);
  }
});

test("a window ends once: the step that ends it is the only one that turns `expired` on", () => {
  let c = fresh;
  const turnedOn: number[] = [];
  for (let now = 0; now <= TOTAL * 2; now += 250) {
    const next = at(c, "a", now % 7_000 < 5_000, now);
    if (next.expired && !c.expired) turnedOn.push(now);
    c = next;
  }
  assert.equal(turnedOn.length, 1);
});

test("remainingMs is never negative", () => {
  assert.equal(remainingMs(fresh, TOTAL * 2), 0);
});
