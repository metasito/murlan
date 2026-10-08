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

test("an onset a frame late on the app's grid against the mockup's virtual one passes, and two frames late fails", () => {
  const mockup = side(0, RECONNECT_SOUND.mockup, { frameMs: 16 });
  const pill = (pillAt: number) => diffReconnect({ mockup, app: side(52_345, RECONNECT_SOUND.app, { pillAt }) }).filter((f) => f.message.startsWith("the pill's"));
  assert.deepEqual(pill(500 + 1000 / 60), []);
  assert.equal(pill(500 + 2 * (1000 / 60) + 1).length, 1);
});

test("an onset stamped on a long frame may lie anywhere in that frame, and no further", () => {
  const mockup = side(0, RECONNECT_SOUND.mockup, { frameMs: 16 });
  const longFrame = (frames: TraceFrame[]) => {
    const at = frames.findIndex((f) => f.onsets.includes("moment:net-net"));
    return frames.filter((_, i) => i !== at - 1);
  };
  const pill = (pillAt: number) =>
    diffReconnect({ mockup, app: longFrame(side(52_345, RECONNECT_SOUND.app, { pillAt })) }).filter((f) => f.message.startsWith("the pill's Riconnessione…,"));
  assert.deepEqual(pill(500 + 2 * (1000 / 60)), []);
  assert.equal(pill(500 + 4 * (1000 / 60)).length, 1);
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
