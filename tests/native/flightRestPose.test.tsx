// tests/native/flightRestPose.test.tsx — the played combination must not jump
// into a different pose after it lands (#828): the group rests at 0deg with
// every card on its slot, wherever the throw started.
import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { act, render, screen } from "@testing-library/react-native";
import { getAnimatedStyle } from "react-native-reanimated";
import type { Card } from "@/lib/game/gameEngine";
import { farthest, flightOf, pileOf } from "./helpers/landing";

const CARDS: Card[] = [{ id: "A_clubs", rank: "A", suit: "clubs", isJoker: false } as Card];

function flyingRotate(): unknown {
  const style = getAnimatedStyle(screen.getByTestId("flying-cards", { includeHiddenElements: true })) as { transform?: Record<string, unknown>[] };
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
    const flight = flightOf("k", CARDS, [from]);
    const r = await render(pileOf({ plays: [flight], flights: [flight] }));
    await act(async () => {
      jest.advanceTimersByTime(3_000);
    });
    expect(flyingRotate()).toBe("0deg");
    expect(farthest(r)).toBe(0);
    await r.unmount();
  });
});
