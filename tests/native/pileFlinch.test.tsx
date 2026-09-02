// tests/native/pileFlinch.test.tsx — the beaten pile's own reaction to being
// displaced as the new card lands (#764).
//
// A source scan proves `prevLayerStyle` is text present in `pile.tsx`; it
// cannot prove that text is *reachable* from the beaten layer's own rendered
// transform. A blind critique defeated the scan twice over — a decoy function
// holding the same matched text while `prevLayerStyle` itself was decoupled
// from `flinchY.value`, and separately, the static `-7deg` resting tilt
// dropped outright — and every test in `tests/gameTableModel.test.ts` stayed
// green through both. Only mounting `PlayedPile` and reading what it actually
// renders can catch either.
import { describe, it, expect, jest } from "@jest/globals";
import React from "react";
import { act, render, screen } from "@testing-library/react-native";
import { getAnimatedStyle } from "react-native-reanimated";
import { PlayedPile } from "@/components/table/pile";
import { Motion } from "@/lib/theme";
import type { Card, Combination } from "@/lib/gameEngine";

const CARD: Card = { id: "3_clubs", suit: "clubs", rank: "3", isJoker: false };
const PREV: Combination = { type: "single", cards: [CARD], strength: 3 };
/** The resting offset `PILE_PREV_Y` (components/table/pile.tsx) — pinned here too, so a change to one without the other is a red rather than a silent drift. */
const RESTING_Y = 9;
const RESTING_ROTATE = "-7deg";

function prevLayerTransform(): Record<string, unknown>[] {
  const node = screen.getByTestId("pile-prev-layer");
  const style = getAnimatedStyle(node) as { transform?: Record<string, unknown>[] };
  return Array.isArray(style.transform) ? style.transform : [];
}

function entry(transform: Record<string, unknown>[], key: string) {
  return transform.find((t) => key in t);
}

describe("the beaten pile's own reaction to being displaced (#764)", () => {
  it("rests with its own -7deg tilt and offset before anything lands on it", async () => {
    const r = await render(
      <PlayedPile prev={PREV} current={null} roundWinner={null} roomW={400} scale={1} />
    );

    const transform = prevLayerTransform();
    expect(entry(transform, "rotate")?.rotate).toBe(RESTING_ROTATE);
    expect(entry(transform, "translateY")?.translateY).toBe(RESTING_Y);

    await r.unmount();
  });

  it("actually moves once the flinch fires — not merely wired to a shared value nobody reads", async () => {
    jest.useFakeTimers();
    const r = await render(
      <PlayedPile
        prev={PREV}
        current={null}
        roundWinner={null}
        flinchTrigger={1}
        flinchTier="bomb"
        roomW={400}
        scale={1}
      />
    );

    // Partway through the flinch's own withTiming leg (Motion.duration.flash)
    // — solidly inside the up-swing, well before the following spring gets a
    // chance to carry it back toward rest.
    await act(async () => {
      jest.advanceTimersByTime(Motion.duration.flash / 2);
      jest.runOnlyPendingTimers();
    });

    const transform = prevLayerTransform();
    // The resting tilt must survive the same worklet the flinch rides —
    // dropping it is the second defect a blind critique planted.
    expect(entry(transform, "rotate")?.rotate).toBe(RESTING_ROTATE);
    // A flinch that fires but never reaches this transform — flinchY.value
    // decoupled from prevLayerStyle, the first defect — would leave this at
    // exactly RESTING_Y no matter how long the animation has run.
    expect(entry(transform, "translateY")?.translateY).toBeGreaterThan(RESTING_Y);

    jest.useRealTimers();
    await r.unmount();
  });
});
