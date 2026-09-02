// tests/native/tableShake.test.tsx — the escalation's own shake (#763) under
// reduced motion.
//
// `useTableFeedback`'s gameOver effect fires `shake("partitaWon")` the moment
// a match closes. `traumaFor` already answers 0 under reduced motion (the
// same derivation `landingHoldMs` reads), so the shared values that shake
// drives should never leave rest — this pins that `shakeStyle` carries no
// transform for a player who asked for less motion, read the way
// `landSquash.test.tsx` (#731) does: off a rendered node's own `props.style`,
// not off the hook's return directly — a `useAnimatedStyle` value read any
// other way is the frozen-at-mount trap loops.md documents.
import { describe, it, expect, afterEach, jest } from "@jest/globals";
import React from "react";
import { render } from "@testing-library/react-native";
import Animated from "react-native-reanimated";
import { useTableFeedback } from "@/components/useTableFeedback";
import { setMotionPreference } from "@/lib/accessibility";

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

function flattenTransform(style: unknown): Record<string, unknown>[] {
  const flat: Record<string, unknown> = Object.assign(
    {},
    ...(Array.isArray(style) ? style.filter(Boolean) : [style])
  );
  return Array.isArray(flat.transform) ? (flat.transform as Record<string, unknown>[]) : [];
}

const gameOverState = () => ({
  isMyTurn: false,
  isFinished: true,
  exchangeActive: false,
  canPass: false,
  playBtnValid: false,
  selectedCount: 0,
  passCount: 0,
  lastPlayedCombination: null,
  roundWinner: null,
  gameOver: true,
  rankings: ["player_0", "player_1"],
  viewerId: "player_1",
  scale: 1,
});

// The partita's own shake fires from `useTableFeedback`'s own gameOver effect,
// which needs a mounted component to run inside — a bare `renderHook` call
// reads the hook's return before that mount-time effect flush is reflected.
function ShakeProbe() {
  const { shakeStyle } = useTableFeedback(gameOverState());
  return <Animated.View testID="shake-probe" style={shakeStyle} />;
}

describe("the table's shake under reduced motion", () => {
  afterEach(() => setMotionPreference("system"));

  it("a match closing with reduced motion already on shakes nothing", async () => {
    setMotionPreference("on");
    const r = await render(<ShakeProbe />);

    const transform = flattenTransform(r.getByTestId("shake-probe").props.style);
    const translateEntries = transform.filter((t) => "translateX" in t || "translateY" in t);
    // Pins that a translate transform actually exists — the shake this ticket
    // adds — rather than passing vacuously because none was ever wired up.
    expect(translateEntries.length).toBeGreaterThan(0);
    for (const entry of translateEntries) {
      if ("translateX" in entry) expect(entry.translateX).toBe(0);
      if ("translateY" in entry) expect(entry.translateY).toBe(0);
    }

    await r.unmount();
  });
});
