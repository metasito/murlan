import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { AppState } from 'react-native';
import * as nativeEngine from '@/lib/device/audioEngine';
import * as webEngine from '@/lib/device/audioEngine.web';
import { SOUND_FILES } from '@/lib/device/soundAssets';
import type { TrackId } from '@/lib/device/musicTracks';
import { api, appStateHandler, ctxTime, effects, fileOf, loops, settle, soundOf, startsOf, voiceGain } from './helpers/feedback';

// The app ships two tracks and keeps two decoded; eviction needs a third.
jest.mock('@/lib/device/musicTracks', () => {
  const actual = jest.requireActual<typeof import('@/lib/device/musicTracks')>('@/lib/device/musicTracks');
  return { ...actual, TRACKS: { ...actual.TRACKS, spare: actual.TRACKS.hand } };
});
const SPARE = 'spare' as TrackId;

const sameSurface: typeof nativeEngine = webEngine;
const lastContext = () => api().contexts.at(-1)!;

function isolated(run: (engine: typeof nativeEngine) => Promise<void>): () => Promise<void> {
  return async () => {
    let engine!: typeof nativeEngine;
    jest.isolateModules(() => {
      engine = require('@/lib/device/audioEngine');
    });
    await run(engine);
  };
}

describe('the audio engine', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('has the same surface on web and native', () => {
    expect(Object.keys(sameSurface).sort()).toEqual(Object.keys(nativeEngine).sort());
  });

  it('configures the session once, to mix with other apps, before building its one context', isolated(async (engine) => {
    await engine.startAudio();
    for (let i = 0; i < 20; i++) engine.play('select');
    expect(api().log).toEqual(['session', 'context', 'preferLowLatency']);
    expect(api().session).toEqual([{ iosCategory: 'playback', iosMode: 'default', iosOptions: ['mixWithOthers'] }]);
  }));

  it('builds its context at 48 kHz and decodes every effect and the first two tracks from the files expo-asset wrote', isolated(async (engine) => {
    await engine.startAudio();
    const effectCount = Object.keys(SOUND_FILES).length;
    const mine = api().decoded.slice(-(effectCount + 2));
    expect(mine.map((b) => b.path)).toEqual(Array.from({ length: effectCount + 2 }, (_, i) => `file:///asset-${i}`));
    expect(lastContext().sampleRate).toBe(48000);
    expect(new Set(mine.map((b) => b.sampleRate))).toEqual(new Set([48000]));
    expect(engine.engineStats().resident).toBe(2);
  }));

  it('drops a play before start; after it, one source starts now, through its own gain, with no onEnded', isolated(async (engine) => {
    engine.play('turn');
    expect(effects()).toEqual([]);
    await engine.startAudio();
    engine.play('turn');
    const [s] = effects();
    expect(soundOf(s)).toBe('turn');
    expect(s.startedAt).toBeCloseTo(ctxTime(performance.now()), 3);
    expect(s.onEnded).toBeUndefined();
    expect(s.outputs[0].kind).toBe('gain');
  }));

  it('starts a play given a time one output latency and half an IO buffer early, and drops one more than an IO buffer late', isolated(async (engine) => {
    await engine.startAudio();
    const now = performance.now();
    engine.play('bomb', { at: now + 300, bus: 'sting' });
    engine.play('select', { at: now - 6 });
    engine.play('select', { at: now - 4 });
    engine.play('select', { at: now - 100 });
    expect(startsOf('bomb')).toEqual([expect.closeTo(ctxTime(now + 300 - 8 - 2.5), 3)]);
    expect(startsOf('select')).toEqual([expect.closeTo(ctxTime(now), 3)]);
  }));

  it("frees a played effect's buffer and gain at the next play", isolated(async (engine) => {
    await engine.startAudio();
    engine.play('turn');
    const [first] = effects();
    const voice = first.outputs[0];
    await settle(1100);
    engine.play('turn');
    expect(first.buffer).toBeNull();
    expect(voice.disconnected).toBe(true);
  }));

  it('backgrounding stops what has not started and holds the buses, so nothing bursts out at resume', isolated(async (engine) => {
    await engine.startAudio();
    const now = performance.now();
    engine.play('bomb', { at: now + 500, bus: 'sting' });
    engine.ramp('music', 0.3, { at: now + 500, ms: 60 });
    const [bomb] = effects();
    appStateHandler()('background');
    expect(bomb.stoppedAt).toBeCloseTo(ctxTime(now), 3);
    expect(bomb.buffer).toBeNull();
    const busGains = lastContext().nodes.filter((n) => n.kind === 'gain').filter((_, i) => i % 2 === 1);
    expect(busGains[2].gain.events.slice(-2)).toEqual([
      { kind: 'cancel', value: NaN, time: expect.closeTo(ctxTime(now), 3) },
      { kind: 'set', value: 1, time: expect.closeTo(ctxTime(now), 3) },
    ]);
    await settle();
    expect(lastContext().state).toBe('suspended');
  }));

  it('a play dropped in the foreground because the context stopped wakes the watchdog, at most once per 2 s', isolated(async (engine) => {
    await engine.startAudio();
    const was = AppState.currentState;
    AppState.currentState = 'active';
    const first = lastContext();
    first.state = 'suspended';
    api().failResumes = 1;
    engine.play('turn');
    engine.play('turn');
    await settle(0);
    await settle(500);
    AppState.currentState = was;
    expect(first.state).toBe('closed');
    expect(engine.engineStats().rebuilds).toBe(1);
  }));

  it('a start that failed is retried when the app next becomes active', isolated(async (engine) => {
    api().failDecode = true;
    await engine.startAudio();
    expect(engine.audioState()).toBe('failed');
    api().failDecode = false;
    appStateHandler()('active');
    await engine.startAudio();
    expect(engine.audioState()).toBe('running');
  }));

  it('a session that refuses its options is a failed start, retried when the app next becomes active', isolated(async (engine) => {
    api().failSession = true;
    await expect(engine.startAudio()).resolves.toBeUndefined();
    expect(engine.audioState()).toBe('failed');
    api().failSession = false;
    appStateHandler()('active');
    await engine.startAudio();
    expect(engine.audioState()).toBe('running');
  }));

  it('a switch made while another track decodes still leaves two decoded', isolated(async (engine) => {
    await engine.startAudio();
    engine.music('hand');
    await settle(1000);
    engine.music(SPARE);
    engine.music('menu');
    await settle();
    await settle();
    expect(fileOf(loops().at(-1)!)).toBe('menu');
    expect(engine.engineStats().resident).toBe(2);
  }));

  it('keeps two tracks decoded, and decodes a third on demand, evicting the least recent', isolated(async (engine) => {
    await engine.startAudio();
    engine.music('menu');
    await settle(1000);
    engine.music('hand');
    await settle(1000);
    const decodedBefore = api().decoded.length;
    engine.music(SPARE);
    expect(loops().map(fileOf)).toEqual(['menu', 'hand']);
    await settle();
    await settle();
    expect(api().decoded.length).toBe(decodedBefore + 1);
    expect(loops()).toHaveLength(3);
    expect(fileOf(loops()[2])).toBe(SPARE);
    expect(engine.engineStats().resident).toBe(2);
  }));

  it('varies a repeated effect within ±4 % pitch and ±8 % gain, never past 1; a sting and a deselect stay fixed', isolated(async (engine) => {
    await engine.startAudio();
    for (let i = 0; i < 200; i++) engine.play('reject');
    for (let i = 0; i < 20; i++) engine.play('bomb');
    engine.play('deselect');
    const rejects = effects().filter((n) => soundOf(n) === 'reject');
    const rates = rejects.map((n) => n.playbackRate.value);
    expect(Math.min(...rates)).toBeGreaterThanOrEqual(0.96 - 1e-9);
    expect(Math.max(...rates)).toBeLessThanOrEqual(1.04 + 1e-9);
    expect(new Set(rates).size).toBeGreaterThan(1);
    for (const n of rejects) {
      expect(voiceGain(n)).toBeGreaterThanOrEqual(0.7 * 0.92 - 1e-9);
      expect(voiceGain(n)).toBeLessThanOrEqual(0.7 * 1.08 + 1e-9);
    }
    expect(new Set(effects().filter((n) => soundOf(n) === 'bomb').map((n) => n.playbackRate.value))).toEqual(new Set([1]));
    const [deselect] = effects().filter((n) => soundOf(n) === 'deselect');
    expect([deselect.playbackRate.value, voiceGain(deselect)]).toEqual([0.9, 0.75]);
  }));

  it('drops a play while the context is not running, and does not queue it', isolated(async (engine) => {
    await engine.startAudio();
    lastContext().state = 'suspended';
    engine.play('turn');
    lastContext().state = 'running';
    await settle(1000);
    expect(effects()).toEqual([]);
  }));

  it('music asked for before start begins once started, looped, from its track', isolated(async (engine) => {
    engine.music('menu');
    await engine.startAudio();
    expect(loops().map(fileOf)).toEqual(['menu']);
  }));

  it('a switch crossfades over 600 ms at one time, and stops the old deck at the fade end', isolated(async (engine) => {
    await engine.startAudio();
    engine.music('menu');
    await settle(1000);
    const t = ctxTime(performance.now());
    engine.music('hand');
    const [menu, hand] = loops();
    expect(menu.outputs[0].gain.events.slice(2)).toEqual([
      { kind: 'hold', value: NaN, time: expect.closeTo(t, 3) },
      { kind: 'ramp', value: 0, time: expect.closeTo(t + 0.6, 3) },
    ]);
    expect(menu.stoppedAt).toBeCloseTo(t + 0.6, 3);
    expect(hand.outputs[0].gain.events).toEqual([
      { kind: 'set', value: 0, time: expect.closeTo(t, 3) },
      { kind: 'ramp', value: 1, time: expect.closeTo(t + 0.6, 3) },
    ]);
  }));

  it('a second switch mid-fade holds the first fade where it is, and retired decks are freed once faded', isolated(async (engine) => {
    await engine.startAudio();
    engine.music('menu');
    await settle(1000);
    engine.music('hand');
    await settle(200);
    const t2 = ctxTime(performance.now());
    engine.music('menu');
    const [menu, hand] = loops();
    expect(hand.outputs[0].gain.events.slice(2)).toEqual([
      { kind: 'hold', value: NaN, time: expect.closeTo(t2, 3) },
      { kind: 'ramp', value: 0, time: expect.closeTo(t2 + 0.6, 3) },
    ]);
    await settle(1000);
    const [menuGain, handGain] = [menu.outputs[0], hand.outputs[0]];
    engine.music('hand');
    expect([menuGain.disconnected, handGain.disconnected]).toEqual([true, true]);
    expect([menu.buffer, hand.buffer]).toEqual([null, null]);
  }));

  it('a context that does not run after the app returns is rebuilt, and the wanted track restarts in it', isolated(async (engine) => {
    await engine.startAudio();
    engine.music('menu');
    const first = lastContext();
    first.state = 'suspended';
    api().failResumes = 1;
    appStateHandler()('active');
    await settle(0);
    await settle(500);
    expect(first.state).toBe('closed');
    expect(lastContext()).not.toBe(first);
    expect(lastContext().state).toBe('running');
    expect(loops().filter((n) => api().contexts.at(-1)!.nodes.includes(n)).map(fileOf)).toEqual(['menu']);
    expect(engine.audioState()).toBe('running');
  }));

  it('a context that reports running with a clock that stands still is rebuilt too', isolated(async (engine) => {
    await engine.startAudio();
    const first = lastContext();
    first.freeze();
    appStateHandler()('active');
    await settle(0);
    await settle(500);
    expect(first.state).toBe('closed');
    expect(lastContext()).not.toBe(first);
  }));

  it('a watchdog that fires after the app went back to the background rebuilds nothing', isolated(async (engine) => {
    await engine.startAudio();
    const first = lastContext();
    first.state = 'suspended';
    api().failResumes = 1;
    appStateHandler()('active');
    await settle(0);
    const was = AppState.currentState;
    AppState.currentState = 'background';
    appStateHandler()('background');
    await settle(500);
    AppState.currentState = was;
    expect(lastContext()).toBe(first);
    expect(engine.engineStats().rebuilds).toBe(0);
  }));

  it('a rebuild the app backgrounds under leaves its new context suspended, with no music', isolated(async (engine) => {
    await engine.startAudio();
    engine.music('menu');
    const first = lastContext();
    first.state = 'suspended';
    api().failResumes = 1;
    appStateHandler()('active');
    await settle(0);
    jest.advanceTimersByTime(500);
    const was = AppState.currentState;
    AppState.currentState = 'background';
    appStateHandler()('background');
    await settle(0);
    AppState.currentState = was;
    const rebuilt = lastContext();
    expect(rebuilt).not.toBe(first);
    expect(rebuilt.state).toBe('suspended');
    expect(loops().filter((n) => rebuilt.nodes.includes(n))).toEqual([]);
  }));

  it('a failed start leaves play harmless', isolated(async (engine) => {
    api().failDecode = true;
    await expect(engine.startAudio()).resolves.toBeUndefined();
    expect(() => engine.play('bomb')).not.toThrow();
    expect(effects()).toEqual([]);
    expect(engine.audioState()).toBe('failed');
  }));

  it('a trim set before start is the bus level once the context runs', isolated(async (engine) => {
    engine.setBusTrim('music', 0.5);
    await engine.startAudio();
    engine.music('menu');
    const bus = loops()[0].outputs[0].outputs[0];
    expect(bus.outputs[0].gain.value).toBe(0.5);
  }));
});
