import { test } from "node:test";
import assert from "node:assert/strict";
import { anchorsOf, diffReconnect, greyAt, onChapterClock, RECONNECT_SOUND } from "../e2e/helpers/reconnectDiff.ts";
import type { TraceFrame } from "../e2e/helpers/traceDiff.ts";

type Plant = {
  greyInMs?: number;
  pillAt?: number;
  clearAt?: number;
  soundAt?: number;
  swayWhileHeld?: boolean;
  stayFrozen?: boolean;
  frameMs?: number;
  giveUpMs?: number;
  lampTo?: number;
};

/** The mockup's chapter: drop at 700, the pill at +500, back at 3400 with the sound, grey 300 ms in and 400 out; dropped again at 5600, given up 2200 ms later with the lamp falling to 0.55 at 1 a second. */
function side(start: number, sound: string, p: Plant = {}): TraceFrame[] {
  const [drop, back, again] = [start + 700, start + 3400, start + 5600];
  const lost = again + (p.giveUpMs ?? 2200);
  const greyIn = p.greyInMs ?? 300;
  const frames: TraceFrame[] = [];
  let ph = 0;
  let prev = start;
  const frameMs = p.frameMs ?? 1000 / 60;
  for (let t = start; t <= lost + 1600; t += frameMs) {
    const held = (t >= drop && t < back) || t >= again;
    if ((!held || p.swayWhileHeld) && !(p.stayFrozen && t >= back)) ph += ((t - prev) / 1000) * 0.84;
    prev = t;
    const greyOf = (from: number) => Math.min(1, (t - from) / greyIn) * 0.85;
    const grey = t < drop ? 0 : t < back ? greyOf(drop) : t < again ? Math.max(0, 1 - (t - back) / 400) * 0.85 : greyOf(again);
    const level = t < lost ? 1 : Math.max(p.lampTo ?? 0.55, 1 - (t - lost) / 1000);
    const onsets: string[] = [];
    const crossed = (at: number) => at <= t && at > t - frameMs;
    if (crossed(drop) || crossed(again)) onsets.push("moment:drop");
    if (crossed(drop + (p.pillAt ?? 500)) || crossed(again + 500)) onsets.push("moment:net-net");
    if (crossed(back)) onsets.push("moment:net-ok");
    if (crossed(back + (p.clearAt ?? 1300))) onsets.push("moment:net-");
    if (crossed(back + (p.soundAt ?? 0))) onsets.push(sound);
    if (crossed(lost)) onsets.push("moment:net-bad");
    frames.push({ t, onsets, live: 0, dropped: 0, lamp: { x: 0, y: 0, level, flare: 0, r: 1, ph }, shake: null, scorePill: null, flight: 0, motes: 0, moth: null, grey });
  }
  return frames;
}

const CHAPTER = { drop: 700, back: 3400, again: 5600, lost: 7800 };

const both = (app: Plant = {}) => ({ mockup: side(0, RECONNECT_SOUND.mockup), app: side(52_345, RECONNECT_SOUND.app, { giveUpMs: 15_000, ...app }) });
const fields = (plant: Plant) => diffReconnect(both(plant)).map((f) => `${f.field}: ${f.message}`);

test("a faithful app passes, on a clock of its own", () => {
  assert.deepEqual(diffReconnect(both()), []);
});

test("each divergence is named for what diverged", () => {
  assert.ok(fields({ greyInMs: 600 }).some((m) => m.startsWith("grey: the grey") && m.endsWith("after the drop")));
  assert.ok(fields({ pillAt: 0 }).includes("onset: the pill's Riconnessione…, in ms after the drop"));
  assert.ok(fields({ clearAt: 2000 }).includes("onset: the pill's Di nuovo in linea clearing, in ms after the back"));
  assert.ok(fields({ soundAt: 100 }).includes("onset: the recovery sound, in ms after the back"));
  assert.ok(fields({ swayWhileHeld: true }).includes("freeze: app: the lamp's phase stands still while held"));
  assert.ok(fields({ stayFrozen: true }).includes("freeze: app: the lamp's phase runs on once back"));
  assert.ok(fields({ lampTo: 0.8 }).some((m) => m.startsWith("level: the lamp's level") && m.endsWith("after the lost")));
});

const FRAME = 1000 / 60;
const mockup16 = () => side(0, RECONNECT_SOUND.mockup, { frameMs: 16 });
const stalled = (frames: TraceFrame[], dropped: number, before: number) => {
  const at = frames.findIndex((f) => f.onsets.includes("moment:net-net")) - before;
  return frames.filter((_, i) => i < at - dropped || i >= at);
};
const pillFailures = (app: TraceFrame[]) =>
  diffReconnect({ mockup: mockup16(), app }).filter((f) => f.message.startsWith("the pill's Riconnessione…,"));
const pillLate = (pillAt: number, dropped = 0, before = 0, frameMs?: number) =>
  pillFailures(stalled(side(52_345, RECONNECT_SOUND.app, { pillAt, frameMs }), dropped, before));

test("an onset two frames late on a smooth app grid against the mockup's virtual one passes, and three frames late fails", () => {
  assert.deepEqual(pillLate(500 + 2 * FRAME), []);
  assert.equal(pillLate(500 + 3 * FRAME + 1).length, 1);
});

test("a stall over the time the pill was due excuses it while the pill lands within four frames of it, and no later", () => {
  assert.deepEqual(pillLate(500 + 15 * FRAME, 30), []);
  assert.deepEqual(pillLate(500 + 8 * FRAME, 6, 3), []);
  assert.equal(pillLate(500 + 9 * FRAME, 6, 4).length, 1);
  assert.equal(pillLate(500 + 20 * FRAME, 10).length, 1);
});

test("a stall over before the pill was due excuses nothing, and no stall excuses an early pill", () => {
  assert.deepEqual(pillLate(500 + 6 * FRAME, 10), []);
  assert.equal(pillLate(500 + 6 * FRAME, 10, 15).length, 1);
  assert.equal(pillLate(500 + 8 * FRAME, 20, 6).length, 1);
  assert.equal(pillLate(500 - 4 * FRAME, 10).length, 1);
});

test("a span counts as a stall from one and a half of the app's frames", () => {
  assert.deepEqual(pillLate(500 + 3 * FRAME + 1, 1), []);
  const app = side(52_345, RECONNECT_SOUND.app, { pillAt: 500 + 3 * FRAME + 1 });
  const pill = app.findIndex((f) => f.onsets.includes("moment:net-net"));
  app[pill - 1] = { ...app[pill - 1], t: app[pill - 1].t - 6 };
  assert.equal(pillFailures(app).length, 1);
});

test("however long one stall at the due point is, a pill later than the ceiling fails", () => {
  assert.deepEqual(pillLate(500 + 17 * FRAME, 18), []);
  assert.equal(pillLate(500 + 60 * FRAME, 60).length, 1);
  assert.equal(pillLate(500 + 19 * FRAME, 20).length, 1);
});

test("the stamping jitter is two of the app's own frames each way, and never less than two at 60 Hz", () => {
  assert.deepEqual(pillLate(600, 0, 0, 60), []);
  assert.deepEqual(pillLate(400, 0, 0, 60), []);
  assert.deepEqual(pillLate(540, 0, 0, 1000 / 120), []);
});

test("an early onset past the ceiling fails on a grid slow enough to stretch the jitter beyond it", () => {
  assert.equal(pillLate(1, 0, 0, 250).length, 1);
});

test("on a slow app grid a faithful pill passes, and one four frames late fails however long every frame is", () => {
  for (const frameMs of [26, 1000 / 30, 60, 250]) {
    assert.deepEqual(pillLate(500, 0, 0, frameMs), [], `${frameMs}`);
    assert.equal(pillLate(500 + 4 * frameMs - 1, 0, 0, frameMs).length, 1, `${frameMs}`);
    assert.equal(pillLate(1500, 0, 0, frameMs).length, 1, `${frameMs}`);
  }
});

test("a side that never drops fails rather than comparing nothing", () => {
  const app = side(0, RECONNECT_SOUND.app).map((f) => ({ ...f, onsets: f.onsets.filter((o) => o !== "moment:drop") }));
  assert.deepEqual(diffReconnect({ mockup: side(0, RECONNECT_SOUND.mockup), app }).map((f) => f.field), ["onset"]);
});

test("the app's frames land on the chapter's clock at every anchor, its longer wait to give up cut to the chapter's", () => {
  const app = side(52_345, RECONNECT_SOUND.app, { giveUpMs: 15_000 });
  const moved = onChapterClock(app, anchorsOf(app)!, CHAPTER);
  const landed = anchorsOf(moved)!;
  for (const anchor of ["drop", "back", "again", "lost"] as const) assert.ok(Math.abs(landed[anchor] - CHAPTER[anchor]) <= 1, anchor);
  assert.ok(moved.every((f, i) => i === 0 || f.t >= moved[i - 1].t));
  assert.ok(Math.abs(greyAt(moved, 1000)! - 0.85) < 0.01);
});
