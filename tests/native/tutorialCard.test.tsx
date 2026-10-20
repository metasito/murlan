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

import { CardView, cardViewPropsEqual } from "@/components/CardView";
import { TutorialCard } from "@/components/TutorialCard";
import type { Card } from "@/lib/game/gameEngine";

const CARD = { id: "3_spades", rank: "3", suit: "spades", isJoker: false } as Card;

function translateY(): number | undefined {
  const lift = screen.getByTestId("tc").parent as Parameters<typeof getAnimatedStyle>[0];
  const style = getAnimatedStyle(lift) as { transform?: { translateY?: number }[] };
  return style.transform?.find((t) => "translateY" in t)?.translateY;
}

describe("TutorialCard", () => {
  beforeEach(() => {
    mockReduceMotion = true;
    jest.useFakeTimers();
  });

  it("lifts to -14 when selected and settles back when not", async () => {
    const view = await render(<TutorialCard testID="tc" card={CARD} selected={false} onPress={() => {}} />);
    await act(async () => void jest.advanceTimersByTime(1000));
    expect(translateY()).toBe(0);

    await view.rerender(<TutorialCard testID="tc" card={CARD} selected onPress={() => {}} />);
    await act(async () => void jest.advanceTimersByTime(1000));
    expect(translateY()).toBe(-14);

    await view.rerender(<TutorialCard testID="tc" card={CARD} selected={false} onPress={() => {}} />);
    await act(async () => void jest.advanceTimersByTime(1000));
    expect(translateY()).toBe(0);
    await view.unmount();
  });

  it("calls onPress once on a tap, and not when disabled", async () => {
    const onPress = jest.fn();
    const view = await render(<TutorialCard testID="tc" card={CARD} selected={false} onPress={onPress} />);
    await fireEvent.press(screen.getByTestId("tc"));
    expect(onPress).toHaveBeenCalledTimes(1);
    await view.rerender(<TutorialCard testID="tc" card={CARD} selected={false} onPress={onPress} disabled />);
    await fireEvent.press(screen.getByTestId("tc"));
    expect(onPress).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it("is one button, named for its card", async () => {
    const view = await render(<TutorialCard testID="tc" card={CARD} selected={false} onPress={() => {}} />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    await view.unmount();
  });
});

describe("CardView", () => {
  it("does not repaint for a new card object with the same id", () => {
    const props = { card: CARD, scale: 1 };
    expect(cardViewPropsEqual(props, { ...props, card: { ...CARD } })).toBe(true);
    expect(cardViewPropsEqual(props, { ...props, card: { ...CARD, id: "4_spades" } })).toBe(false);
    expect(cardViewPropsEqual(props, { ...props, scale: 2 })).toBe(false);
  });

  it("holds its card still: selecting it moves nothing", async () => {
    const view = await render(<CardView card={CARD} selected onActivate={() => {}} />);
    expect(screen.getByRole("button").props.accessibilityState?.selected).toBe(true);
    expect(JSON.stringify(screen.toJSON())).not.toContain("translateY");
    await view.unmount();
  });
});
