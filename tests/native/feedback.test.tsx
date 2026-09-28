import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  backgroundMusic, event, setHapticsEnabled, setSoundVolume, silence, startLandingPulses, uiFeedback,
} from '@/lib/device/feedback';
import { bootFeedback, ctxAt, ctxTime, effects, fileOf, hapticCalls, haptics, loops, musicBus, settle, sounds, startsOf } from './helpers/feedback';

const NINE_DB_DOWN = 10 ** (-9 / 20);
const STING_S = 1;

describe('feedback', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    await bootFeedback();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('moments raised in one commit are one event, and it sounds its highest moment', async () => {
    event([{ kind: 'turn' }]);
    event([{ kind: 'pass' }, { kind: 'roundWon' }]);
    await settle();
    expect(sounds()).toEqual(['round_win']);
    expect(haptics()).toEqual(['impactLight']);
  });

  it('a sting ducks the music 9 dB over 60 ms at its start, and returns over 400 ms at its end', async () => {
    backgroundMusic('menu');
    const at = performance.now() + 500;
    event([{ kind: 'mancheOver', outcome: 'won' }], at);
    await settle();
    expect(musicBus().gain.events).toEqual([
      { kind: 'hold', value: NaN, time: expect.closeTo(ctxAt(at), 3) },
      { kind: 'ramp', value: expect.closeTo(NINE_DB_DOWN, 3), time: expect.closeTo(ctxAt(at) + 0.06, 3) },
      { kind: 'hold', value: NaN, time: expect.closeTo(ctxAt(at) + STING_S, 3) },
      { kind: 'ramp', value: 1, time: expect.closeTo(ctxAt(at) + STING_S + 0.4, 3) },
    ]);
  });

  it('the music switch after a sting waits for the sting to end', async () => {
    backgroundMusic('menu');
    const at = performance.now() + 500;
    event([{ kind: 'mancheOver', outcome: 'lost' }], at);
    await settle();
    backgroundMusic('hand');
    const hand = loops().find((n) => fileOf(n) === 'hand')!;
    expect(hand.startedAt!).toBeGreaterThanOrEqual(ctxAt(at) + STING_S - 1e-3);
  });

  it('an event given a time already past starts nothing, and never plays late', async () => {
    event([{ kind: 'landing', cards: 1, bomb: false, mine: true }], performance.now() - 100);
    await settle();
    expect(effects()).toEqual([]);
  });

  it('the partita haptic leads its sting by 300 ms, and the sting is in the engine at once', async () => {
    const at = performance.now() + 1000;
    event([{ kind: 'partitaOver', won: true }], at);
    await settle();
    expect(startsOf('partitaWon')).toEqual([expect.closeTo(ctxAt(at), 3)]);
    await settle(1000);
    expect(hapticCalls()).toEqual([
      { type: 'impactMedium', at: expect.closeTo(at - 300, 0) },
      { type: 'notificationSuccess', at: expect.closeTo(at, 0) },
    ]);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('sound volume 0 and haptics off leave nothing behind an event', async () => {
    setSoundVolume(0);
    setHapticsEnabled(false);
    event([{ kind: 'landing', cards: 4, bomb: true, mine: true }]);
    startLandingPulses({ cards: 4, bomb: true, mine: true });
    uiFeedback('selection');
    uiFeedback('seatFill');
    await settle(1000);
    expect(effects()).toEqual([]);
    expect(haptics()).toEqual([]);
  });

  it('haptics off silences the haptic, not the sound', async () => {
    setHapticsEnabled(false);
    event([{ kind: 'select' }]);
    await settle();
    expect(sounds()).toEqual(['select']);
    expect(haptics()).toEqual([]);
  });

  it('a landing sounds through event and pulses only through startLandingPulses', async () => {
    event([{ kind: 'landing', cards: 1, bomb: false, mine: true }]);
    await settle();
    expect([sounds(), haptics()]).toEqual([['play'], []]);
    startLandingPulses({ cards: 1, bomb: false, mine: true });
    await settle();
    expect(haptics()).toEqual(['impactLight']);
  });

  it('silencing the clock stops its voice now', async () => {
    event([{ kind: 'clockRunningOut' }]);
    await settle();
    silence('clockRunningOut');
    expect(effects()[0].stoppedAt).toBeCloseTo(ctxTime(performance.now()), 3);
  });

  it('music plays the track the route asks for, once', async () => {
    backgroundMusic('menu');
    backgroundMusic('menu');
    expect(loops().map(fileOf)).toEqual(['menu']);
  });
});
