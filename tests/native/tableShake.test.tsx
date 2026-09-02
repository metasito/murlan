// tests/native/tableShake.test.tsx — the escalation's own shake (#763).
//
// The tier→trauma mapping and the decay math are asserted directly against
// the pure functions in `tests/gameTableModel.test.ts` — a `useAnimatedStyle`
// read off a rendered node freezes at mount (`settleForMotion`, same file,
// documents the trap) and cannot pin a later reactive change. This only pins
// the shape `shakeStyle` starts at rest.
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
  it("nothing has landed yet, so the offset is zero", async () => {
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

    await r.unmount();
  });
});
