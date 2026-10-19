// tests/native/particleLayerRedraw.test.tsx — resizing the web particle canvas clears it, so the
// loop that resized it draws once even when the scene is asleep under reduced motion (#1654).
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { makeMutable } from 'react-native-reanimated';
import { animate } from '@/components/table/particleLayer.web';
import { createScene } from '@/components/table/particleSprites';
import { restingLamp, TABLE_CENTRE } from '@/components/table/lampRig';

const g = globalThis as Record<string, unknown>;
let frames: ((now: number) => void)[] = [];
let clears = 0;
let now = 0;

const fakeCanvas = () => {
  const ctx: object = new Proxy({} as Record<string | symbol, unknown>, {
    get: (known, key) => (key in known ? known[key] : key === 'clearRect' ? () => clears++ : () => ctx),
    set: (known, key, value) => ((known[key] = value), true),
  });
  return { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
};

const runFrame = () => {
  const due = frames;
  frames = [];
  now += 16;
  for (const f of due) f(now);
};

const saved = { document: g.document, raf: g.requestAnimationFrame, caf: g.cancelAnimationFrame };

beforeEach(() => {
  g.document = { createElement: fakeCanvas };
  g.requestAnimationFrame = (f: (now: number) => void) => (frames.push(f), frames.length);
  g.cancelAnimationFrame = () => (frames = []);
});

afterEach(() => {
  g.document = saved.document;
  g.requestAnimationFrame = saved.raf;
  g.cancelAnimationFrame = saved.caf;
});

describe('the web particle layer under reduced motion', () => {
  it('draws after the canvas is resized, though the scene is asleep', () => {
    const scene = createScene(Math.random);
    const lamp = makeMutable(restingLamp(TABLE_CENTRE));
    const cv = fakeCanvas();
    const stop = animate(cv, scene, lamp, true, 1, 1)!;
    let asleep = false;
    for (let i = 0; i < 2000 && !asleep; i++) {
      const before = clears;
      runFrame();
      asleep = clears === before;
    }
    expect(asleep).toBe(true);
    stop();

    const before = clears;
    animate(cv, scene, lamp, true, 2, 2);
    runFrame();
    expect(clears).toBe(before + 1);
  });
});
