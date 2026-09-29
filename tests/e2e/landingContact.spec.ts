import { test, expect } from "./fixtures";
import { installVirtualClock, step, takeOver } from "./helpers/virtualClock";
import { botMove, pairsTable, pass, playLowest, recorded } from "./helpers/mockupParity";

test.use({ launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] } });

const SOUND_SPY = `(() => {
  window.__scheduled = [];
  window.__badStamps = [];
  let used = null;
  const stamp = AudioContext.prototype.getOutputTimestamp;
  AudioContext.prototype.getOutputTimestamp = function () {
    const c0 = this.currentTime, p0 = performance.now();
    used = stamp.call(this);
    // Mapping through the stamp alone reads back the engine's own \`at\` whatever it holds; only reads taken around it can catch a skewed one.
    const q = 128 / this.sampleRate;
    const ok = used.contextTime >= c0 - q && used.contextTime <= this.currentTime + q && used.performanceTime >= p0 && used.performanceTime <= performance.now();
    if (!ok) window.__badStamps.push({ contextTime: used.contextTime, performanceTime: used.performanceTime, c0, p0 });
    queueMicrotask(() => (used = null));
    return used;
  };
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (when = 0, ...rest) {
    const ctx = this.context;
    // The engine's own stamp: the audio clock runs on under the paused page clock, and a fresh currentTime can be a render burst past it.
    const s = used ?? { contextTime: ctx.currentTime, performanceTime: performance.now() };
    window.__scheduled.push({ at: s.performanceTime + Math.max(0, when - s.contextTime) * 1000, state: ctx.state });
    return start.call(this, when, ...rest);
  };
})()`;

// The scheduled `when` only. Output latency is the device's, and Task 11's gate measures it on the phone; adding it here would move the spec with the headless browser's audio sink.
test("each landing sound is scheduled for the frame the cards touch the pile", async ({ page, baseURL }) => {
  await installVirtualClock(page, 1259);
  await page.addInitScript(SOUND_SPY);
  await pairsTable(page, baseURL!);
  await takeOver(page);
  await page.evaluate(() => (globalThis as unknown as { murlanTrace: { start(): void } }).murlanTrace.start());
  for (const move of [playLowest(2), botMove, pass, botMove]) {
    await move(page);
    for (let i = 0; i < 60; i++) await step(page);
  }
  const frames = await recorded(page);
  const contacts: number[] = [];
  let flying = false;
  // The recorder's rAF callback runs before Reanimated's in every tick, so a frame's `flight` is the previous frame's paint.
  frames.forEach((f, i) => {
    if (!flying && f.flight > 1) flying = true;
    else if (flying && f.flight <= 1) {
      contacts.push(frames[i - 1].t);
      flying = false;
    }
  });
  expect(contacts.length, "three flights traced").toBe(3);
  const sounds = (await page.evaluate(() => (window as unknown as { __scheduled: { at: number; state: string }[] }).__scheduled));
  expect(sounds.every((s) => s.state === "running"), "the audio context is running").toBe(true);
  const badStamps = await page.evaluate(() => (window as unknown as { __badStamps: unknown[] }).__badStamps);  expect(badStamps, "every audio stamp lies between the clock reads around it").toEqual([]);
  for (const c of contacts) {
    const nearest = Math.min(...sounds.map((s) => Math.abs(s.at - c)));
    expect(nearest, `a landing sound within 16 ms of the contact frame at ${c} ms`).toBeLessThanOrEqual(16);
  }
  const onsets = frames.filter((f) => f.onsets.includes("moment:landing")).map((f) => f.t);
  expect(onsets.length).toBe(3);
  onsets.forEach((t, i) => expect(Math.abs(t - contacts[i]), `moment:landing ${i}`).toBeLessThanOrEqual(16));
});
