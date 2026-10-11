import { test } from "node:test";
import assert from "node:assert/strict";
import { recordFrames, type FrameHost } from "../../lib/e2eTrace.ts";

const FRAME = 16;

/** Playwright's clock: timers run by due time, then by the order they were made; a frame is due on the next 16 ms. */
function fakeClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; seq: number; run: () => void }>();
  const add = (at: number, run: () => void) => {
    const id = ++seq;
    timers.set(id, { at, seq: id, run });
    return id;
  };
  const host: FrameHost & { setTimeout(run: () => void, ms: number): number } = {
    requestAnimationFrame: (callback) => {
      const id: number = add(now + FRAME - (now % FRAME), () => callback(timers.get(id)?.at ?? now));
      return id;
    },
    cancelAnimationFrame: (id) => void timers.delete(id),
    setTimeout: (run, ms) => add(now + ms, run),
  };
  const runFor = (ms: number) => {
    const to = now + ms;
    for (;;) {
      const next = [...timers.entries()].filter(([, x]) => x.at <= to).sort(([, a], [, b]) => a.at - b.at || a.seq - b.seq)[0];
      if (!next) break;
      now = next[1].at;
      next[1].run();
      timers.delete(next[0]);
    }
    now = to;
  };
  return { host, runFor };
}

function frameLoop(host: FrameHost) {
  const state = { value: 0 };
  const loop = (t: number) => {
    state.value = t;
    host.requestAnimationFrame(loop);
  };
  return { state, start: () => host.requestAnimationFrame(loop) };
}

test("a frame loop registered after the recorder is read on the frame it stepped", () => {
  const { host, runFor } = fakeClock();
  const source = frameLoop(host);
  const recorder = recordFrames(host, (t) => ({ t, value: source.state.value }));
  recorder.start();
  source.start();
  runFor(4 * FRAME);
  assert.deepEqual(recorder.frames, [16, 32, 48, 64].map((t) => ({ t, value: t })));
});

test("a frame loop a timer starts mid-frame is read on its first frame", () => {
  const { host, runFor } = fakeClock();
  const source = frameLoop(host);
  const recorder = recordFrames(host, (t) => ({ t, value: source.state.value }));
  recorder.start();
  host.setTimeout(source.start, 20);
  runFor(3 * FRAME);
  assert.deepEqual(recorder.frames, [{ t: 16, value: 0 }, { t: 32, value: 32 }, { t: 48, value: 48 }]);
});

test("a cancelled frame callback does not hold back the frame's sample", () => {
  const { host, runFor } = fakeClock();
  const recorder = recordFrames(host, (t) => t);
  recorder.start();
  host.setTimeout(() => host.cancelAnimationFrame(late), FRAME);
  const late = host.requestAnimationFrame(() => assert.fail("cancelled"));
  runFor(2 * FRAME);
  assert.deepEqual(recorder.frames, [16, 32]);
});

test("a stopped recorder samples nothing until it starts again", () => {
  const { host, runFor } = fakeClock();
  const recorder = recordFrames(host, (t) => t);
  recorder.start();
  runFor(FRAME);
  recorder.stop();
  runFor(2 * FRAME);
  assert.deepEqual(recorder.frames, [16]);
  recorder.start();
  runFor(FRAME);
  assert.deepEqual(recorder.frames, [64]);
});
