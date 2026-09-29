import { describe, it, expect, jest, afterEach } from "@jest/globals";
import { act, fireEvent, render, screen, within } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import type { TestInstance } from "test-renderer";
import { getAnimatedStyle } from "react-native-reanimated";
import { setMotionPreference } from "@/lib/accessibility";
import { pileOf } from "./helpers/landing";
import { Motion, Spacing } from "@/lib/theme";
import type { Card, Combination } from "@/lib/game/gameEngine";

const CARD: Card = { id: "3_clubs", suit: "clubs", rank: "3", isJoker: false };
const SINGLE: Combination = { type: "single", cards: [CARD], strength: 3 };
const BOMB: Combination = { type: "bomb", cards: [CARD, CARD, CARD, CARD], strength: 3 };

function chipStyle() {
  return getAnimatedStyle(screen.getByTestId("combo-chip")) as {
    opacity?: number;
    transform?: Record<string, number>[];
  };
}

const riseOf = (s: ReturnType<typeof chipStyle>) => s.transform?.find((t) => "translateY" in t)?.translateY;

const pile = (combo: Combination) => pileOf({ comboLabel: combo });

const flat = (n: TestInstance) => (StyleSheet.flatten(n.props.style) ?? {}) as { transform?: Record<string, number>[]; fontSize?: number; paddingHorizontal?: number; paddingVertical?: number };
const scaledBy = (n: TestInstance | null): number => (n ? (flat(n).transform?.find((t) => "scale" in t)?.scale ?? 1) * scaledBy(n.parent) : 1);
async function drawnAt(scale: number) {
  const r = await render(pileOf({ comboLabel: SINGLE, roundWinner: "Ana", scale }));
  const chip = screen.getByTestId("combo-chip");
  const tag = screen.getByText("Ana");
  const drawn = { chip: flat(chip), chipScale: scaledBy(chip), font: flat(within(chip).getByText(/./)).fontSize, tag: flat(tag).fontSize, tagScale: scaledBy(tag) };
  await r.unmount();
  return drawn;
}

describe("the combo chip enters, and a power play's chip catches a sheen", () => {
  afterEach(async () => {
    await act(async () => setMotionPreference("system"));
    jest.useRealTimers();
  });

  it("rises Spacing.xs and fades in over Motion.duration.shift", async () => {
    jest.useFakeTimers();
    const r = await render(pile(SINGLE));
    expect(chipStyle().opacity).toBe(0);
    expect(riseOf(chipStyle())).toBe(Spacing.xs);

    await act(async () => {
      jest.advanceTimersByTime(Motion.duration.shift);
      jest.runOnlyPendingTimers();
    });
    expect(chipStyle().opacity).toBe(1);
    expect(riseOf(chipStyle())).toBe(0);
    expect(screen.queryByTestId("combo-chip-sheen")).toBeNull();
    await r.unmount();
  });

  it("a bomb's chip carries a sheen that passes once, over Motion.duration.reveal", async () => {
    jest.useFakeTimers();
    const r = await render(pile(BOMB));
    await fireEvent(screen.getByTestId("combo-chip"), "layout", { nativeEvent: { layout: { width: 80, height: 20 } } });
    const band = () => getAnimatedStyle(within(screen.getByTestId("combo-chip-sheen")).getByTestId("sweep")) as { opacity?: number };

    await act(async () => { jest.advanceTimersByTime(Motion.duration.reveal / 2); });
    expect(band().opacity).toBe(1);
    await act(async () => { jest.advanceTimersByTime(Motion.duration.reveal / 2 + 16); });
    expect(band().opacity).toBe(0);
    await r.unmount();
  });

  it("keeps the chip's and the winner tag's fixed size whatever the table's scale", async () => {
    const big = await drawnAt(1.6);
    expect(big.chip).toMatchObject({ paddingHorizontal: Spacing.snug, paddingVertical: Spacing.xxs });
    expect(big).toEqual(await drawnAt(1));
    expect([big.chipScale, big.tagScale]).toEqual([1, 1]);
  });

  it("under reduced motion the chip is simply there, with no sheen", async () => {
    setMotionPreference("on");
    const r = await render(pile(BOMB));
    expect(chipStyle().opacity).toBe(1);
    expect(riseOf(chipStyle())).toBe(0);
    expect(screen.queryByTestId("combo-chip-sheen")).toBeNull();
    await r.unmount();
  });
});
