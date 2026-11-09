// tests/native/particleLayerRedraw.test.tsx — resizing the web particle canvas clears it, so the
// loop that resized it draws once even when the scene is asleep under reduced motion (#1654).
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { makeMutable } from 'react-native-reanimated';
import { animate } from '@/components/table/particleLayer.web';
import { createScene } from '@/components/table/particleSprites';
import { spawn } from '@/components/table/particles';
import { DESIGN, restingLamp, TABLE_CENTRE } from '@/components/table/lampRig';

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
    const { stop } = animate(cv, scene, lamp, true, 1, 1)!;
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

describe('the web particle layer asleep under reduced motion', () => {
  const sleep = (scene: ReturnType<typeof createScene>) => {
    const loop = animate(fakeCanvas(), scene, makeMutable(restingLamp(TABLE_CENTRE)), true, 1, 1)!;
    for (let i = 0; i < 2000 && frames.length; i++) runFrame();
    return loop;
  };

  it('asks for no further frame once asleep', () => {
    const loop = sleep(createScene(Math.random));
    expect(frames).toHaveLength(0);
    loop.stop();
  });

  it('draws again, from one frame, when a spawn wakes it', () => {
    const scene = createScene(Math.random);
    const loop = sleep(scene);
    const before = clears;
    spawn(scene.s, { x: 100, y: 100, life: 5, size: 4 });
    loop.wake();
    loop.wake();
    expect(frames).toHaveLength(1);
    runFrame();
    expect(clears).toBe(before + 1);
    expect(frames).toHaveLength(1);
    loop.stop();
  });

  it('is not woken while it runs', () => {
    const loop = animate(fakeCanvas(), createScene(Math.random), makeMutable(restingLamp(TABLE_CENTRE)), true, 1, 1)!;
    loop.wake();
    expect(frames).toHaveLength(1);
    loop.stop();
  });
});

describe('the web particle layer at full motion', () => {
  const drawn = (scene: ReturnType<typeof createScene>, frameCount: number) => {
    const lamp = makeMutable(restingLamp(TABLE_CENTRE));
    const { stop } = animate(fakeCanvas(), scene, lamp, false, 1, 1)!;
    runFrame();
    const before = clears;
    for (let i = 0; i < frameCount; i++) runFrame();
    stop();
    return clears - before;
  };

  it('draws ambient motes at most every 33 ms', () => {
    expect(drawn(createScene(Math.random), 60)).toBeLessThanOrEqual(31);
  });

  it('draws every frame while a burst is live', () => {
    const scene = createScene(Math.random);
    spawn(scene.s, { x: 100, y: 100, life: 5, size: 4 });
    expect(drawn(scene, 30)).toBe(30);
  });

  it('sizes the canvas at device pixel ratio 1', () => {
    const dpr = Object.getOwnPropertyDescriptor(g, 'devicePixelRatio');
    Object.defineProperty(g, 'devicePixelRatio', { value: 3, configurable: true });
    const cv = fakeCanvas();
    animate(cv, createScene(Math.random), makeMutable(restingLamp(TABLE_CENTRE)), false, 1, 1)!.stop();
    if (dpr) Object.defineProperty(g, 'devicePixelRatio', dpr);
    else delete g.devicePixelRatio;
    expect(cv.width).toBe(DESIGN.width);
  });
});
