import { describe, it, expect, jest, afterEach } from "@jest/globals";
import { act, render, screen, within } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import type { TestInstance } from "test-renderer";
import { getAnimatedStyle } from "react-native-reanimated";
import { setMotionPreference } from "@/lib/accessibility";
import { pileOf } from "./helpers/landing";
import { mockupPx } from "@/components/table/noticeModel";
import type { Card, Combination } from "@/lib/game/gameEngine";

const CARD: Card = { id: "3_clubs", suit: "clubs", rank: "3", isJoker: false };
const SINGLE: Combination = { type: "single", cards: [CARD], strength: 3 };
const BOMB: Combination = { type: "bomb", cards: [CARD, CARD, CARD, CARD], strength: 3 };
const ROYAL: Combination = { type: "royal_straight", cards: [CARD, CARD, CARD, CARD, CARD], strength: 3 };
/** #1259 Q1: a mark enters in the mockup's 100 ms. */
const MARK_ENTER_MS = 100;
/** The mockup's rise for every notice, in mockup px. */
const RISE_PX = 6;

const mark = () => screen.getByTestId("notice-combo");

function markStyle() {
  return getAnimatedStyle(mark()) as { opacity?: number; transform?: Record<string, number>[] };
}

const riseOf = (s: ReturnType<typeof markStyle>) => s.transform?.find((t) => "translateY" in t)?.translateY;

const pile = (combo: Combination) => pileOf({ comboLabel: combo });

type Flat = { transform?: Record<string, number>[]; fontSize?: number; height?: number; paddingHorizontal?: number; backgroundColor?: string; borderColor?: string; borderRadius?: number; color?: string };
const flat = (n: TestInstance) => (StyleSheet.flatten(n.props.style) ?? {}) as Flat;
const scaledBy = (n: TestInstance | null): number => (n ? (flat(n).transform?.find((t) => "scale" in t)?.scale ?? 1) * scaledBy(n.parent) : 1);

async function drawnAt(scale: number) {
  const r = await render(pileOf({ comboLabel: SINGLE, roundWinner: "Ana", scale }));
  const chip = mark();
  const tag = screen.getByTestId("notice-roundWinner");
  const drawn = {
    chip: flat(chip),
    chipScale: scaledBy(chip),
    font: flat(within(chip).getByText(/./)).fontSize,
    tag: flat(tag),
    tagScale: scaledBy(tag),
  };
  await r.unmount();
  return drawn;
}

async function paintOf(combo: Combination) {
  const r = await render(pile(combo));
  const text = within(mark()).getByText(/./);
  const drawn = { plate: flat(mark()), ink: flat(text).color, words: text.props.children, sheen: screen.queryByTestId("combo-chip-sheen") };
  await r.unmount();
  return drawn;
}

describe("the combination mark enters as the mockup's .cchip, the same for every combination", () => {
  afterEach(async () => {
    await act(async () => setMotionPreference("system"));
    jest.useRealTimers();
  });

  it("keeps combo-chip around the mark", async () => {
    const r = await render(pile(SINGLE));
    expect(within(screen.getByTestId("combo-chip")).getByTestId("notice-combo")).toBeTruthy();
    await r.unmount();
  });

  it("rises the mockup's 6 px and fades in over 100 ms (Q1)", async () => {
    jest.useFakeTimers();
    const r = await render(pile(SINGLE));
    expect(markStyle().opacity).toBe(0);
    expect(riseOf(markStyle())).toBeCloseTo(mockupPx(RISE_PX, 1), 5);

    await act(async () => {
      jest.advanceTimersByTime(MARK_ENTER_MS);
      jest.runOnlyPendingTimers();
    });
    expect(markStyle().opacity).toBe(1);
    expect(riseOf(markStyle())).toBe(0);
    await r.unmount();
  });

  it("a power combination paints the same mark", async () => {
    const single = await paintOf(SINGLE);
    for (const power of [BOMB, ROYAL]) {
      const drawn = await paintOf(power);
      expect(drawn.plate.backgroundColor).toBe(single.plate.backgroundColor);
      expect(drawn.plate.borderColor).toBe(single.plate.borderColor);
      expect(drawn.ink).toBe(single.ink);
      expect(String(drawn.words)).not.toContain("✦");
      expect(drawn.sheen).toBeNull();
    }
  });

  it("is drawn at the table's scale, its text never under the floor of 10 (Q3)", async () => {
    const big = await drawnAt(1.6);
    const small = await drawnAt(1);
    expect(big.chip.height).toBeCloseTo(small.chip.height! * 1.6, 5);
    expect(big.chip.paddingHorizontal).toBeCloseTo(small.chip.paddingHorizontal! * 1.6, 5);
    expect(big.tag.height).toBeCloseTo(small.tag.height! * 1.6, 5);
    expect(small.font).toBe(10);
    expect([big.chipScale, big.tagScale]).toEqual([1, 1]);
  });

  it("under reduced motion the mark does not rise", async () => {
    setMotionPreference("on");
    const r = await render(pile(BOMB));
    expect(riseOf(markStyle())).toBe(0);
    expect(screen.queryByTestId("combo-chip-sheen")).toBeNull();
    await r.unmount();
  });
});
