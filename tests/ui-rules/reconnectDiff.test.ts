import { test } from "node:test";
import assert from "node:assert/strict";
import { anchorsOf, diffReconnect, greyAt, onChapterClock, RECONNECT_SOUND } from "../e2e/helpers/reconnectDiff.ts";
import type { TraceFrame } from "../e2e/helpers/traceDiff.ts";

type Plant = { greyInMs?: number; pillAt?: number; soundAt?: number; swayWhileHeld?: boolean; stayFrozen?: boolean };

/** The mockup's chapter: drop at 700, the pill at +500, back at 3400 with the sound, grey 300 ms in and 400 out. */
function side(start: number, sound: string, p: Plant = {}): TraceFrame[] {
  const [drop, back] = [start + 700, start + 3400];
  const greyIn = p.greyInMs ?? 300;
  const frames: TraceFrame[] = [];
  let ph = 0;
  let prev = start;
  for (let t = start; t <= start + 4400; t += 1000 / 60) {
    const held = t >= drop && t < back;
    if ((!held || p.swayWhileHeld) && !(p.stayFrozen && t >= back)) ph += ((t - prev) / 1000) * 0.84;
    prev = t;
    const grey = t < drop ? 0 : t < back ? Math.min(1, (t - drop) / greyIn) * 0.85 : Math.max(0, 1 - (t - back) / 400) * 0.85;
    const onsets: string[] = [];
    const crossed = (at: number) => at <= t && at > t - 1000 / 60;
    if (crossed(drop)) onsets.push("moment:drop");
    if (crossed(drop + (p.pillAt ?? 500))) onsets.push("moment:net-net");
    if (crossed(back)) onsets.push("moment:net-ok");
    if (crossed(back + (p.soundAt ?? 0))) onsets.push(sound);
    frames.push({ t, onsets, live: 0, dropped: 0, lamp: { x: 0, y: 0, level: 1, flare: 0, r: 1, ph }, shake: null, scorePill: null, flight: 0, motes: 0, moth: null, grey });
  }
  return frames;
}

const both = (app: Plant = {}) => ({ mockup: side(0, RECONNECT_SOUND.mockup), app: side(52_345, RECONNECT_SOUND.app, app) });
const fields = (plant: Plant) => diffReconnect(both(plant)).map((f) => `${f.field}: ${f.message}`);

test("a faithful app passes, on a clock of its own", () => {
  assert.deepEqual(diffReconnect(both()), []);
});

test("each divergence is named for what diverged", () => {
  assert.ok(fields({ greyInMs: 600 }).some((m) => m.startsWith("grey: the grey") && m.endsWith("after the drop")));
  assert.ok(fields({ pillAt: 0 }).includes("onset: the pill's Riconnessione…, in ms after the drop"));
  assert.ok(fields({ soundAt: 100 }).includes("onset: the recovery sound, in ms after the back"));
  assert.ok(fields({ swayWhileHeld: true }).includes("freeze: app: the lamp's phase stands still while held"));
  assert.ok(fields({ stayFrozen: true }).includes("freeze: app: the lamp's phase runs on once back"));
});

test("a side that never drops fails rather than comparing nothing", () => {
  const app = side(0, RECONNECT_SOUND.app).map((f) => ({ ...f, onsets: f.onsets.filter((o) => o !== "moment:drop") }));
  assert.deepEqual(diffReconnect({ mockup: side(0, RECONNECT_SOUND.mockup), app }).map((f) => f.field), ["onset"]);
});

test("the app's frames land on the chapter's clock at both anchors", () => {
  const app = side(52_345, RECONNECT_SOUND.app);
  const own = anchorsOf(app)!;
  const moved = onChapterClock(app, own, { drop: 700, back: 3400 });
  assert.ok(Math.abs(anchorsOf(moved)!.drop - 700) <= 1);
  assert.ok(Math.abs(anchorsOf(moved)!.back - 3400) <= 1);
  assert.ok(Math.abs(greyAt(moved, 1000)! - 0.85) < 0.01);
});
