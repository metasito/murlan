import { test, expect } from "./fixtures";
import { installVirtualClock, step, takeOver } from "./helpers/virtualClock";
import { botMove, pairsTable, pass, playLowest, recorded } from "./helpers/mockupParity";

test.use({ launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] } });

const SOUND_SPY = `(() => {
  window.__scheduled = [];
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (when = 0, ...rest) {
    const ctx = this.context;
    const lead = Math.max(when, ctx.currentTime) - ctx.currentTime;
    window.__scheduled.push({ at: performance.now() + lead * 1000, state: ctx.state });
    return start.call(this, when, ...rest);
  };
})()`;

// The scheduled `when` only. Output latency is the device's, and Task 11's gate measures it on the phone; adding it here would move the spec with the headless browser's audio sink.
test("each landing sound is scheduled for the frame the cards touch the pile", async ({ page, baseURL }) => {
  await page.addInitScript(SOUND_SPY);
  await installVirtualClock(page, 1259);
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
  for (const c of contacts) {
    const nearest = Math.min(...sounds.map((s) => Math.abs(s.at - c)));
    expect(nearest, `a landing sound within 16 ms of the contact frame at ${c} ms`).toBeLessThanOrEqual(16);
  }
  const onsets = frames.filter((f) => f.onsets.includes("moment:landing")).map((f) => f.t);
  expect(onsets.length).toBe(3);
  onsets.forEach((t, i) => expect(Math.abs(t - contacts[i]), `moment:landing ${i}`).toBeLessThanOrEqual(16));
});
