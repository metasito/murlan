// tests/native/flightRestPose.test.tsx — the played combination must not jump
// into a different pose after it lands (#828).
//
// FlyingCards draws the cards while they travel; PlayedPile draws them again
// once the flight ends. The group's resting rotation has to be the 0deg
// PileComboCards draws at, wherever the throw started.
import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import React from "react";
import { act, render, screen } from "@testing-library/react-native";
import { getAnimatedStyle, makeMutable } from "react-native-reanimated";
import { FlyingCards } from "@/components/table/pile";
import { pileSlots } from "@/components/flightPose";
import { flightSpec, NO_LANDING } from "@/components/table/useFlightClock";
import type { Card } from "@/lib/game/gameEngine";

const CARDS: Card[] = [{ id: "A_clubs", rank: "A", suit: "clubs", isJoker: false } as Card];

function flyingRotate(): unknown {
  const style = getAnimatedStyle(screen.getByTestId("flying-cards")) as { transform?: Record<string, unknown>[] };
  return (style.transform ?? []).find((t) => "rotate" in t)?.rotate;
}

describe("a played combination lands in the pose it is drawn in (#828)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it.each([
    ["the hand", { x: 30, y: 160, rot: 4, scale: 1.4 }],
    ["a side fan", { x: -300, y: 0, rot: -90, scale: 0.4 }],
    ["the top fan", { x: 0, y: -140, rot: 0, scale: 0.4 }],
  ])("comes to rest at 0deg thrown from %s", async (_, from) => {
    const r = await render(
      <FlyingCards
        cards={CARDS}
        flight={flightSpec("k", [from], pileSlots(1, 60, 400), false, false)}
        landing={NO_LANDING}
        signal={makeMutable(NO_LANDING)}
        onEnd={() => {}}
      />
    );
    await act(async () => {
      jest.advanceTimersByTime(3_000);
    });
    expect(flyingRotate()).toBe("0deg");
    await r.unmount();
  });
});
