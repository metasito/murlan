// tests/native/tutorialCard.test.tsx — the tutorial's card lifts when selected and answers a tap;
// CardView, the painter under it, does neither, and does not repaint for a card it already drew.
import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { getAnimatedStyle } from "react-native-reanimated";

let mockReduceMotion = true;
jest.mock("@/lib/accessibility", () => ({
  ...(jest.requireActual("@/lib/accessibility") as object),
  usePrefersReducedMotion: () => mockReduceMotion,
}));

const mockRenders = { card: 0, animatedHooks: 0 };
jest.mock("@/lib/cosmetics", () => {
  const actual = jest.requireActual("@/lib/cosmetics") as typeof import("@/lib/cosmetics");
  return {
    ...actual,
    useCardBackId: () => {
      mockRenders.card += 1;
      return actual.useCardBackId();
    },
  };
});
jest.mock("react-native-reanimated", () => {
  const actual = jest.requireActual("react-native-reanimated") as Record<string, unknown>;
  const count =
    (name: string) =>
    (...args: unknown[]) => {
      mockRenders.animatedHooks += 1;
      return (actual[name] as (...a: unknown[]) => unknown)(...args);
    };
  const counted: Record<string, unknown> = {
    useSharedValue: count("useSharedValue"),
    useAnimatedStyle: count("useAnimatedStyle"),
  };
  return new Proxy(actual, { get: (target, key: string) => counted[key] ?? target[key] });
});

import { CardView, PRESS_RISE, PRESS_TILT } from "@/components/CardView";
import { TutorialCard } from "@/components/TutorialCard";
import type { Card } from "@/lib/game/gameEngine";

const CARD = { id: "3_spades", rank: "3", suit: "spades", isJoker: false } as Card;

type Transform = { translateY?: number; rotate?: string }[];
function transform(): Transform {
  const lift = screen.getByTestId("tc").parent as Parameters<typeof getAnimatedStyle>[0];
  return (getAnimatedStyle(lift) as { transform: Transform }).transform;
}
const translateY = () => transform().find((t) => "translateY" in t)?.translateY;
const settle = () => act(async () => void jest.advanceTimersByTime(3000));
const card = (selected: boolean, onPress = () => {}) => (
  <TutorialCard testID="tc" card={CARD} selected={selected} onPress={onPress} />
);

describe("TutorialCard", () => {
  beforeEach(() => {
    mockReduceMotion = true;
    jest.useFakeTimers();
  });

  it.each([
    ["under reduced motion", true],
    ["with motion", false],
  ])("lifts to -14 when selected and settles back when not, %s", async (_, reduced) => {
    mockReduceMotion = reduced;
    const view = await render(card(false));
    await settle();
    expect(translateY()).toBe(0);

    await view.rerender(card(true));
    await settle();
    expect(translateY()).toBeCloseTo(-14, 1);

    await view.rerender(card(false));
    await settle();
    expect(translateY()).toBeCloseTo(0, 1);
    await view.unmount();
  });

  it("springs rather than jumping when motion is allowed", async () => {
    mockReduceMotion = false;
    const view = await render(card(false));
    await settle();
    await view.rerender(card(true));
    await act(async () => void jest.advanceTimersByTime(16));
    expect(translateY()).toBeGreaterThan(-14);
    expect(translateY()).toBeLessThan(0);
    await view.unmount();
  });

  it("rises and tips under a finger, translate before rotate, and lets go", async () => {
    const view = await render(card(true));
    await settle();
    await fireEvent(screen.getByTestId("tc"), "pressIn");
    await settle();
    const [first, second] = transform();
    expect(first.translateY).toBeCloseTo(-14 + PRESS_RISE, 1);
    expect(parseFloat(second.rotate!)).toBeCloseTo(PRESS_TILT, 1);

    await fireEvent(screen.getByTestId("tc"), "pressOut");
    await settle();
    expect(translateY()).toBeCloseTo(-14, 1);
    expect(parseFloat(transform()[1].rotate!)).toBeCloseTo(0, 1);
    await view.unmount();
  });

  it("calls onPress once on a tap, and not when disabled", async () => {
    const onPress = jest.fn();
    const view = await render(card(false, onPress));
    await fireEvent.press(screen.getByTestId("tc"));
    expect(onPress).toHaveBeenCalledTimes(1);
    await view.rerender(<TutorialCard testID="tc" card={CARD} selected={false} onPress={onPress} disabled />);
    await fireEvent.press(screen.getByTestId("tc"));
    expect(onPress).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it("is one button carrying the testID, the name and the selection", async () => {
    const view = await render(card(true));
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toBe(screen.getByTestId("tc"));
    expect(buttons[0].props.accessibilityLabel).toBeTruthy();
    expect(buttons[0].props.accessibilityState?.selected).toBe(true);
    await view.unmount();
  });
});

describe("CardView", () => {
  beforeEach(() => {
    mockRenders.card = 0;
    mockRenders.animatedHooks = 0;
  });

  it("does not re-render for a new card object with the same id, and does for another card", async () => {
    const view = await render(<CardView card={CARD} />);
    const mounted = mockRenders.card;
    expect(mounted).toBeGreaterThan(0);

    await view.rerender(<CardView card={{ ...CARD }} />);
    expect(mockRenders.card).toBe(mounted);

    await view.rerender(<CardView card={{ ...CARD, id: "4_spades", rank: "4" }} />);
    expect(mockRenders.card).toBeGreaterThan(mounted);
    await view.unmount();
  });

  it("holds its card still: no shared value, no animated style, however selected", async () => {
    const view = await render(<CardView card={CARD} selected onActivate={() => {}} />);
    expect(screen.getByRole("button").props.accessibilityState?.selected).toBe(true);
    expect(mockRenders.animatedHooks).toBe(0);
    await view.unmount();
  });
});
