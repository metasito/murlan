// tests/native/webAudioGesture.test.ts — Chrome and Safari park an AudioContext
// built outside a user gesture in `suspended`, and Safari honours `resume()`
// only when it is called synchronously inside the gesture. So the context must
// not exist until a gesture builds it.
//
// Both halves are asserted here. A test that only proved "nothing is built on
// mount" would pass just as green on a build that never plays audio at all.
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

jest.mock('react-native', () => ({ Platform: { OS: 'web' } }));
jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(),
  setAudioModeAsync: jest.fn(async () => {}),
}));

type Handler = () => void;

let constructed = 0;
let resumeCalls = 0;
let decodeCalls = 0;
let ctxState: string;
let handlers: Map<string, Handler>;

class FakeAudioContext {
  state: string;
  constructor() {
    constructed += 1;
    this.state = ctxState;
  }
  resume() {
    resumeCalls += 1;
    this.state = 'running';
    return Promise.resolve();
  }
  decodeAudioData() {
    decodeCalls += 1;
    return Promise.resolve({} as AudioBuffer);
  }
  createBufferSource() {
    return { buffer: null, connect() {}, start() {} };
  }
  createGain() {
    return { gain: { value: 0 }, connect() {} };
  }
  get destination() {
    return {};
  }
}

function loadSounds() {
  let mod!: typeof import('@/lib/sounds');
  jest.isolateModules(() => {
    mod = require('@/lib/sounds') as typeof import('@/lib/sounds');
  });
  return mod;
}

beforeEach(() => {
  constructed = 0;
  resumeCalls = 0;
  decodeCalls = 0;
  ctxState = 'suspended';
  handlers = new Map();
  (globalThis as Record<string, unknown>).window = { AudioContext: FakeAudioContext };
  (globalThis as Record<string, unknown>).document = {
    addEventListener: (event: string, fn: Handler) => handlers.set(event, fn),
  };
  (globalThis as Record<string, unknown>).fetch = jest.fn(async () => ({
    arrayBuffer: async () => new ArrayBuffer(8),
  })) as never;
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).document;
  delete (globalThis as Record<string, unknown>).fetch;
});

describe('the web AudioContext waits for a gesture', () => {
  it('builds no context while preloading on mount', async () => {
    const sounds = loadSounds();

    await sounds.preloadSounds();

    expect(constructed).toBe(0);
    // The floor: preloading must still have done its work, or "no context"
    // would be true of a preload that never ran.
    expect(globalThis.fetch).toHaveBeenCalled();
  });

  it('builds the context on the first gesture, and resumes it before any await', async () => {
    const sounds = loadSounds();
    await sounds.preloadSounds();
    sounds.bindWebAudioUnlock();

    const onPointerDown = handlers.get('pointerdown');
    expect(onPointerDown).toBeDefined();

    onPointerDown!();

    // Read synchronously — nothing is awaited between here and the handler, so
    // a resume() sitting behind an await would not have run yet.
    expect(constructed).toBe(1);
    expect(resumeCalls).toBe(1);
  });

  it('resumes from Safari\'s interrupted state, not just suspended', async () => {
    ctxState = 'interrupted';
    const sounds = loadSounds();
    await sounds.preloadSounds();
    sounds.bindWebAudioUnlock();

    handlers.get('pointerdown')!();

    expect(resumeCalls).toBe(1);
  });

  it('decodes what the preload fetched only once there is a context to decode with', async () => {
    const sounds = loadSounds();
    await sounds.preloadSounds();
    sounds.bindWebAudioUnlock();

    // Bytes are fetched on mount, but nothing can decode them yet.
    expect(decodeCalls).toBe(0);

    handlers.get('pointerdown')!();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(decodeCalls).toBeGreaterThan(0);
  });

  it('keeps listening, so a later interruption recovers on the next tap', async () => {
    const sounds = loadSounds();
    await sounds.preloadSounds();
    sounds.bindWebAudioUnlock();

    const tap = handlers.get('pointerdown')!;
    tap();
    expect(resumeCalls).toBe(1);

    // A phone call, or another app taking the audio session, after the tap
    // that first unlocked it.
    tap();

    // Still the one context — the listener recovers it rather than rebuilding.
    expect(constructed).toBe(1);
    expect(resumeCalls).toBe(1);
  });
});
