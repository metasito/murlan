// tests/native/flightRestPose.test.tsx — the played combination must not jump
// into a different pose after it lands (#828).
//
// FlyingCards draws the cards while they travel; PlayedPile draws them again
// once the flight reports itself finished. The two have to agree on where a
// combination rests, or the handoff between them reads as a jump — so this
// pins that FlyingCards' own resting rotation is the same 0deg PileComboCards
// draws its group at (no rotate transform at all), for every throw direction.
import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import React from "react";
import { act, render, screen } from "@testing-library/react-native";
import { getAnimatedStyle } from "react-native-reanimated";
import { FlyingCards } from "@/components/table/pile";
import { FLIGHT_MS } from "@/components/gameTableModel";
import type { Card } from "@/lib/gameEngine";

jest.mock("react-native-worklets", () => {
  const actual = jest.requireActual("react-native-worklets") as any;
  return { ...actual, scheduleOnRN: () => {} };
});

const CARDS: Card[] = [{ id: "A_clubs", rank: "A", suit: "clubs", isJoker: false } as Card];

function flyingRotate(): unknown {
  const node = screen.getByTestId("flying-cards");
  const style = getAnimatedStyle(node) as { transform?: Record<string, unknown>[] };
  const transform = Array.isArray(style.transform) ? style.transform : [];
  return transform.find((t) => "rotate" in t)?.rotate;
}

describe("a played combination lands in the pose it is drawn in (#828)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it.each(["bottom", "top", "left", "right"] as const)(
    "the flight's own resting rotation is 0deg thrown from %s, once it and its settle are done",
    async (direction) => {
      const r = await render(
        <FlyingCards
          cards={CARDS}
          direction={direction}
          origin={{ dx: 0, dy: -100 }}
          onDone={() => {}}
          roomW={400}
          scale={1}
        />
      );

      // Well past the throw, the hold and the settle spring — the same floor
      // flightFloor.test.tsx uses to be sure a flight has fully run its course.
      await act(async () => {
        jest.advanceTimersByTime(FLIGHT_MS * 20);
      });

      expect(flyingRotate()).toBe("0deg");

      await r.unmount();
    }
  );
});
