// tests/native/tableShakeReducedMotion.test.tsx — #794: the escalation's own
// shake (#763) must read reduced motion at the point `shake()` sets
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
// `useSharedValue` to capture every shared value `shake()`'s component tree
// creates, and mocks `traumaFor` to answer a value nothing else in the app
// produces. The capture happens inside a *synchronous* `act()` callback, in
// the same tick as the call to `shake()` — a write that is briefly wrong and
// only corrected in a later microtask would still read wrong at that point,
// so this only passes if the write `shake()` makes is already right the
// instant it returns, not merely by the time something later reads it.
import { describe, it, expect, jest, afterEach } from '@jest/globals';
import React from 'react';
import { act, render } from '@testing-library/react-native';
import * as gameTableModel from '@/components/gameTableModel';
import { setMotionPreference } from '@/lib/accessibility';
import type { ImpactTier } from '@/components/gameTableModel';

/** Every shared value any component under test creates, in creation order. */
const mockCapturedSharedValues: { value: unknown }[] = [];

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
  };
});

// Imported after the mock above (jest hoists `jest.mock` calls to the top of
// the file, ahead of every import) so both this file's `Animated.View` and
// `useTableFeedback.ts`'s own `useSharedValue` calls go through the wrapper.
import Animated from 'react-native-reanimated';
import { useTableFeedback } from '@/components/useTableFeedback';

jest.mock('@/lib/sounds', () => ({
  ensureAudioMode: jest.fn(),
  playBomb: jest.fn(),
  playCardPass: jest.fn(),
  playCardPlay: jest.fn(),
  playExchange: jest.fn(),
  playGameLose: jest.fn(),
  playGameWin: jest.fn(),
  playYourTurn: jest.fn(),
}));
jest.mock('@/lib/haptics', () => ({
  hapticHeavy: jest.fn(),
  hapticSuccess: jest.fn(),
  hapticWarn: jest.fn(),
}));
jest.mock('@/lib/music', () => ({ cancelMusicDuck: jest.fn(), duckMusicFor: jest.fn() }));

// A value no real trauma, amplitude, decay-ms or flash/glow shared value in
// this tree would ever hold on its own — every other one either starts and
// stays at a small integer (0, 1) or carries a `Spacing`/`Motion` token.
// Distinctive on purpose: with `traumaFor` answering *this* under reduced
// motion, finding it among the captured shared values only happens if
// `shake()`'s write actually carries what `traumaFor` returned.
const SENTINEL = 0.918273645;

const idleState = () => ({
  isMyTurn: false,
  isFinished: false,
  exchangeActive: false,
  canPass: false,
  playBtnValid: false,
  selectedCount: 0,
  passCount: 0,
  lastPlayedCombination: null,
  roundWinner: null,
  gameOver: false,
  rankings: [],
  viewerId: undefined,
  scale: 1,
});

function ShakeProbe({ shakeRef }: { shakeRef: React.MutableRefObject<((tier: ImpactTier) => void) | null> }) {
  const { shakeStyle, shake } = useTableFeedback(idleState());
  shakeRef.current = shake;
  return <Animated.View testID="shake-probe" style={shakeStyle} />;
}

describe('the shake reads reduced motion at the point trauma is set (#794)', () => {
  afterEach(async () => {
    await act(async () => setMotionPreference('system'));
    jest.restoreAllMocks();
    mockCapturedSharedValues.length = 0;
  });

  it("shake()'s write carries traumaFor's own answer, not a value read and then discarded", async () => {
    setMotionPreference('on');
    // Every real call in this tree still reaches the pure `traumaFor` — its
    // reduced-motion branch is pinned directly in tests/gameTableModel.test.ts
    // — this only swaps its *answer* for one that is identifiable later.
    const traumaSpy = jest.spyOn(gameTableModel, 'traumaFor').mockReturnValue(SENTINEL);
    const shakeRef: React.MutableRefObject<((tier: ImpactTier) => void) | null> = { current: null };
    const r = await render(<ShakeProbe shakeRef={shakeRef} />);

    // Nothing on mount holds the sentinel — only `shake()`'s own write can
    // introduce it.
    expect(mockCapturedSharedValues.some((sv) => sv.value === SENTINEL)).toBe(false);

    // Captured by a synchronous statement inside `act()`'s callback, right
    // after calling `shake()` and before that statement — or the callback
    // itself — ever yields to the microtask queue: a mutation that writes a
    // wrong value first and corrects it a tick later would still be caught
    // wrong here, not merely right by the time the test looks again.
    let sentinelLandedSynchronously = false;
    await act(async () => {
      shakeRef.current!('bomb');
      sentinelLandedSynchronously = mockCapturedSharedValues.some((sv) => sv.value === SENTINEL);
    });

    // The point trauma is set: `shake()` must hand `traumaFor` the *live*
    // reduced-motion flag.
    expect(traumaSpy).toHaveBeenCalledWith('bomb', true);
    // And what actually lands in a shared value, in the same tick as the
    // call — not merely what `shake()` read and could have discarded, and not
    // merely what a later microtask could still correct to — is `traumaFor`'s
    // own answer.
    expect(sentinelLandedSynchronously).toBe(true);

    await r.unmount();
  });
});
