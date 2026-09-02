// tests/native/tableShakeReducedMotion.test.tsx — #794: the escalation's own
// shake (#763) must read reduced motion at the point `shake()` sets
// `shakeTrauma`, not merely end up at rest by the time anything reads it.
//
// `tests/native/tableShake.test.tsx` only samples an idle mount — zero either
// way, whether or not `shake()` itself respects reduced motion — and reading
// the driven `shakeStyle` after calling `shake()` proves nothing here either:
// this repo's reanimated jest shim resolves `withTiming` synchronously
// (`tests/native/setup.ts`), which collapses `shakeElapsed` straight to its
// decayed end the instant `shake()` returns, so the rendered offset reads 0
// after *any* call, correct or not — confirmed empirically: a planted
// mutation that fed `traumaFor` a hardcoded `false` still drove a zero style.
// The only place left to catch "wrote the full trauma, then papered over it
// later" is the call itself: this pins that `traumaFor` — the pure function
// `reduceMotion` actually reaches — is invoked with the live flag at the
// point `shake()` computes trauma, and that its own answer, not a later
// correction, is what the write carries.
import { describe, it, expect, jest, afterEach } from '@jest/globals';
import React from 'react';
import { act, render } from '@testing-library/react-native';
import Animated from 'react-native-reanimated';
import * as gameTableModel from '@/components/gameTableModel';
import { useTableFeedback } from '@/components/useTableFeedback';
import { setMotionPreference } from '@/lib/accessibility';
import type { ImpactTier } from '@/components/gameTableModel';

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
  });

  it('a bomb landing after mount reads the live reduced-motion flag, and takes the zero-trauma branch', async () => {
    setMotionPreference('on');
    const traumaSpy = jest.spyOn(gameTableModel, 'traumaFor');
    const shakeRef: React.MutableRefObject<((tier: ImpactTier) => void) | null> = { current: null };
    const r = await render(<ShakeProbe shakeRef={shakeRef} />);

    await act(async () => {
      shakeRef.current!('bomb');
    });

    // The point trauma is set: `shake()` must hand `traumaFor` the *live*
    // reduced-motion flag, not a stale or hardcoded one — a call with `false`
    // here is a full-strength trauma about to be written, whatever zeroes it
    // afterward.
    expect(traumaSpy).toHaveBeenCalledWith('bomb', true);
    // And that call's own answer — not a second, later correction — is what
    // reaches the write: reduced motion means `traumaFor` itself already
    // answered 0.
    expect(traumaSpy).toHaveReturnedWith(0);

    await r.unmount();
  });
});
