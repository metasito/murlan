// tests/native/pileFlinch.test.tsx — the beaten pile's own reaction to being
// displaced as the new card lands (#764).
//
// A source scan proves the flinch is text present in `pile.tsx`; it cannot
// prove that text is *reachable* from the beaten group's own rendered
// transform. A blind critique defeated the scan twice over — a decoy function
// holding the same matched text while the beaten style itself was decoupled
// from `flinchY.value`, and separately, the static `-7deg` resting tilt
// dropped outright — and every test in `tests/ui-rules/flightPhysics.test.ts` stayed
// green through both. Only mounting `PileLayer` and reading what it actually
// renders can catch either.
import { describe, it, expect, jest } from "@jest/globals";
import { act, render, screen } from "@testing-library/react-native";
import { getAnimatedStyle, makeMutable } from "react-native-reanimated";
import { NO_LANDING } from "@/components/table/useFlightClock";
import { fireLanding, flightOf, pileOf } from "./helpers/landing";
import { Motion } from "@/lib/theme";
import type { Card } from "@/lib/game/gameEngine";

const BEATEN: Card = { id: "3_clubs", suit: "clubs", rank: "3", isJoker: false };
const TOP: Card = { id: "4_clubs", suit: "clubs", rank: "4", isJoker: false };
const AT_REST = { x: 0, y: 0, rot: 0, scale: 1 };
const PLAYS = [flightOf("beaten", [BEATEN], [AT_REST]), flightOf("top", [TOP], [AT_REST])];
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
    const r = await render(pileOf({ plays: PLAYS }));

    const transform = prevLayerTransform();
    expect(entry(transform, "rotate")?.rotate).toBe(RESTING_ROTATE);
    expect(entry(transform, "translateY")?.translateY).toBe(RESTING_Y);

    await r.unmount();
  });

  it("actually moves once the flinch fires — not merely wired to a shared value nobody reads", async () => {
    jest.useFakeTimers();
    const landing = makeMutable(NO_LANDING);
    const r = await render(pileOf({ plays: PLAYS, signal: landing }));
    await act(async () => {
      jest.advanceTimersByTime(16);
      fireLanding(landing, { cards: 4, heavy: true });
    });

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
    // decoupled from the beaten style, the first defect — would leave this at
    // exactly RESTING_Y no matter how long the animation has run.
    expect(entry(transform, "translateY")?.translateY).toBeGreaterThan(RESTING_Y);

    jest.useRealTimers();
    await r.unmount();
  });
});
