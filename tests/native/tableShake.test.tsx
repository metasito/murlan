// tests/native/tableShake.test.tsx — the escalation's own shake (#763): what
// a native render can and cannot pin.
//
// The tier→trauma mapping, the reduced-motion zeroing (all five tiers, and
// that it is exactly 0 rather than merely small), and the trauma-squared
// decay are asserted directly against the pure functions in
// `tests/gameTableModel.test.ts`'s "the table's own trauma escalation
// (#763)" describe block — not here. A `useAnimatedStyle` value read off a
// rendered node's `props.style`, under this repo's jest-expo reanimated
// mock, is frozen at whatever it was when the component mounted and does not
// reactively update from a later shared-value write (`settleForMotion`,
// tests/gameTableModel.test.ts, documents the same trap for #783's flight
// squash) — so a probe that called `shake()` after mount and re-read the
// style would pass whether or not the decay actually ran. What a mount-time
// read CAN pin honestly is the shape `shakeStyle` starts at: nothing has
// fired yet, so the transform is a no-op and the veil it drives is invisible.
import { describe, it, expect, jest } from "@jest/globals";
import React from "react";
import { render } from "@testing-library/react-native";
import Animated from "react-native-reanimated";
import { useTableFeedback } from "@/components/useTableFeedback";

jest.mock("@/lib/sounds", () => ({
  playBomb: jest.fn(),
  playCardPass: jest.fn(),
  playCardPlay: jest.fn(),
  playExchange: jest.fn(),
  playGameLose: jest.fn(),
  playGameWin: jest.fn(),
  playYourTurn: jest.fn(),
}));
jest.mock("@/lib/haptics", () => ({
  hapticHeavy: jest.fn(),
  hapticSuccess: jest.fn(),
  hapticWarn: jest.fn(),
}));
jest.mock("@/lib/music", () => ({ cancelMusicDuck: jest.fn(), duckMusicFor: jest.fn() }));

function flattenStyle(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...(Array.isArray(style) ? style.filter(Boolean) : [style]));
}

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

function ShakeProbe() {
  const { shakeStyle } = useTableFeedback(idleState());
  return <Animated.View testID="shake-probe" style={shakeStyle} />;
}

describe("the table's shake, at rest", () => {
  it("nothing has landed yet, so the veil sits at zero offset and zero opacity", async () => {
    const r = await render(<ShakeProbe />);

    const flat = flattenStyle(r.getByTestId("shake-probe").props.style);
    const transform = Array.isArray(flat.transform) ? (flat.transform as Record<string, unknown>[]) : [];
    const translateX = transform.find((t) => "translateX" in t);
    const translateY = transform.find((t) => "translateY" in t);
    // Pins that a translate transform actually exists — the shake this
    // ticket adds — rather than passing vacuously because none was wired up.
    expect(translateX).toBeDefined();
    expect(translateY).toBeDefined();
    expect(translateX?.translateX).toBe(0);
    expect(translateY?.translateY).toBe(0);
    expect(flat.opacity ?? 0).toBe(0);

    await r.unmount();
  });
});
