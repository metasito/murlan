// tests/native/tableShakeReducedMotion.test.tsx — #794: the escalation's own
// shake (#763) must read reduced motion at the point the landing sets
// `shakeTrauma`, not merely end up at rest by the time anything reads it.
//
// `tests/native/tableShake.test.tsx` only samples an idle mount — zero either
// way, whether or not `shake()` itself respects reduced motion — and reading
// the driven `shakeStyle` after calling `shake()` proves nothing here either:
// this repo's reanimated jest shim resolves `withTiming` synchronously
// (`tests/native/setup.ts`) and `Motion.reduced.shake` is itself 0
// (`lib/tokens.ts`), which collapses `shakeMagnitude`'s `decayMs <= 0` branch
// to 0 the instant `shake()` returns, so the rendered offset reads 0 after
// *any* call under reduced motion, whatever `shakeTrauma` itself was set to
// (verified empirically — a planted mutation that wrote a hardcoded
// full-strength trauma still drove a zero style).
//
// `shakeTrauma` itself is not exposed by the hook, so this wraps
// `useSharedValue` to capture every shared value the tree creates, and mocks
// `traumaFor` to answer a value nothing else in the app produces.
import { describe, it, expect, jest, afterEach } from '@jest/globals';
import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import * as flightPhysics from '@/components/flightPhysics';
import { setMotionPreference } from '@/lib/accessibility';
import { setScreenShakeEnabled } from '@/lib/screenShake';
import type { ImpactTier } from '@/components/flightPhysics';

/** Every shared value any component under test creates, in creation order. */
const mockCapturedSharedValues: { value: unknown }[] = [];
const mockSequences = { count: 0 };

jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual('react-native-reanimated') as typeof import('react-native-reanimated');
  return {
    ...actual,
    // `__esModule` is a non-enumerable own property on the real module, so the
    // spread above silently drops it — without it back, `_interopRequireDefault`
    // treats this mock as a non-ES module and wraps the whole object as the
    // default export, which is why `Animated.View` (the real default export's
    // own property) reads as `undefined` without this line.
    __esModule: true,
    useSharedValue: (initial: unknown) => {
      const sv = actual.useSharedValue(initial);
      mockCapturedSharedValues.push(sv);
      return sv;
    },
    withSequence: (...steps: Parameters<typeof actual.withSequence>) => {
      mockSequences.count += 1;
      return actual.withSequence(...steps);
    },
  };
});

// Imported after the mock above (jest hoists `jest.mock` calls to the top of
// the file, ahead of every import) so both this file's `Animated.View` and
// `useTableFeedback.ts`'s own `useSharedValue` calls go through the wrapper.
import Animated, { getAnimatedStyle, makeMutable, type SharedValue } from 'react-native-reanimated';
import { Motion } from '@/lib/theme';
import { NO_LANDING, type LandingSignal } from '@/components/table/useFlightClock';
import { fireLanding, useFeedbackOnTimeline } from './helpers/landing';

// A value no real trauma, amplitude, decay-ms or flash/glow shared value in
// this tree would ever hold on its own — every other one either starts and
// stays at a small integer (0, 1) or carries a `Spacing`/`Motion` token.
// Distinctive on purpose: with `traumaFor` answering *this* under reduced
// motion, finding it among the captured shared values only happens if
// `shake()`'s write actually carries what `traumaFor` returned.
const SENTINEL = 0.918273645;

// `gameOver` stays false for the whole probe, so `handOutcomeFor` (which
// reads `players`/`isTeamMode`/`handScores`) is never reached — these are
// here only to satisfy `TableFeedbackState`, empty and neutral.
const idleState = () => ({
  isMyTurn: false,
  currentTurnIndex: 0,
  isFinished: false,
  exchangeActive: false,
  canPass: false,
  passCount: 0,
  lastPlayedCombination: null,
  roundWinner: null,
  gameOver: false,
  rankings: [],
  players: [],
  isTeamMode: false,
  handScores: {},
  viewerId: undefined,
  scale: 1,
});

function ShakeProbe({ landing }: { landing: SharedValue<LandingSignal> }) {
  const { shakeStyle } = useFeedbackOnTimeline({ ...idleState(), landing });
  return <Animated.View testID="shake-probe" style={shakeStyle} />;
}

async function mount() {
  jest.useFakeTimers();
  const landing = makeMutable(NO_LANDING);
  const r = await render(<ShakeProbe landing={landing} />);
  await act(async () => { jest.advanceTimersByTime(16); });
  const land = (tier: ImpactTier) =>
    act(async () => {
      fireLanding(landing, { cards: 4, tier, heavy: tier === 'bomb' });
      jest.advanceTimersByTime(16);
    });
  return { r, land };
}

describe('the shake reads reduced motion at the point trauma is set (#794)', () => {
  afterEach(async () => {
    await act(async () => setMotionPreference('system'));
    await act(async () => setScreenShakeEnabled(true));
    mockSequences.count = 0;
    jest.restoreAllMocks();
    mockCapturedSharedValues.length = 0;
  });

  it("shake()'s write carries traumaFor's own answer, not a value read and then discarded", async () => {
    setMotionPreference('on');
    // Every real call in this tree still reaches the pure `traumaFor` — its
    // reduced-motion branch is pinned directly in tests/ui-rules/flightPhysics.test.ts
    // — this only swaps its *answer* for one that is identifiable later.
    const traumaSpy = jest.spyOn(flightPhysics, 'traumaFor').mockReturnValue(SENTINEL);
    const { r, land } = await mount();

    // Nothing on mount holds the sentinel — only the landing's own write can
    // introduce it.
    expect(mockCapturedSharedValues.some((sv) => sv.value === SENTINEL)).toBe(false);

    await land('bomb');

    // The point trauma is set: the landing must hand `traumaFor` the *live*
    // reduced-motion flag, and what lands in a shared value is its answer.
    expect(traumaSpy).toHaveBeenCalledWith('bomb', true, false);
    expect(mockCapturedSharedValues.some((sv) => sv.value === SENTINEL)).toBe(true);

    jest.useRealTimers();
    await r.unmount();
  });

  it.each([true, false])('screen shake %s: the shake and the kick both follow the toggle', async (enabled) => {
    setMotionPreference('off');
    setScreenShakeEnabled(enabled);
    const traumaSpy = jest.spyOn(flightPhysics, 'traumaFor');
    const { r, land } = await mount();
    mockSequences.count = 0;

    await land('bomb');

    expect(traumaSpy).toHaveBeenCalledWith('bomb', false, !enabled);
    expect(mockSequences.count > 0).toBe(enabled);

    jest.useRealTimers();
    await r.unmount();
  });

  it.each<[ImpactTier, boolean]>([['bomb', true], ['mancheWon', false]])('%s: the shake rotates the table only for a bomb', async (tier, turns) => {
    setMotionPreference('off');
    const { r, land } = await mount();
    await land(tier);
    await act(async () => { jest.advanceTimersByTime(Motion.duration.shake / 12); });

    const { transform } = getAnimatedStyle(screen.getByTestId('shake-probe')) as unknown as { transform: Record<string, string>[] };
    const deg = parseFloat(transform.find((t) => 'rotate' in t)!.rotate);
    expect(Math.abs(deg) > 0).toBe(turns);
    jest.useRealTimers();
    await r.unmount();
  });
});
