// tests/native/beatenPose.test.tsx — a play takes the beaten pose from the throw that beats it,
// on its own views, even while they are still in the air (D4 #5, task 4's review M2).
import { describe, it, expect, jest, afterEach } from "@jest/globals";
import { act, render, screen, within } from "@testing-library/react-native";
import { getAnimatedStyle, makeMutable } from "react-native-reanimated";
import { NO_LANDING } from "@/components/table/useFlightClock";
import { card, flightOf, pileOf } from "./helpers/landing";
import { setMotionPreference } from "@/lib/accessibility";
import { Beaten, Motion } from "@/lib/theme";

const HIDDEN = { includeHiddenElements: true };
const FROM = { x: -180, y: 160, rot: 24, scale: 1.2 };
const A = flightOf("a", [card("a1", "3", "clubs"), card("a2", "3", "hearts")], [FROM, FROM]);
const B = flightOf("b", [card("b1", "4", "clubs"), card("b2", "4", "hearts")], [FROM, FROM]);

function styleOf(node: Parameters<typeof getAnimatedStyle>[0]) {
  const s = getAnimatedStyle(node) as { opacity?: number; transform?: Record<string, number | string>[] };
  const t = s.transform ?? [];
  return {
    opacity: s.opacity ?? 1,
    rotate: parseFloat(String(t.find((x) => "rotate" in x)?.rotate ?? "0")),
    drop: Number(t.find((x) => "translateY" in x)?.translateY ?? 0),
  };
}

async function beatMidFlight() {
  const signal = makeMutable(NO_LANDING);
  const r = await render(pileOf({ plays: [A], flights: [A], signal }));
  await act(async () => jest.advanceTimersByTime(16));
  await r.rerender(pileOf({ plays: [A, B], flights: [A, B], signal }));
  return r;
}

const step = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
    jest.runOnlyPendingTimers();
  });

afterEach(() => {
  setMotionPreference("system");
  jest.useRealTimers();
});

describe("the beaten pose (D4 #5)", () => {
  it("turns a play still in the air from the throw that beats it, under one shade per card", async () => {
    jest.useFakeTimers();
    const r = await beatMidFlight();
    await step(Motion.beaten / 2);

    const group = screen.getByTestId("pile-prev-layer", HIDDEN);
    expect(within(group).getAllByTestId("flying-card", HIDDEN)).toHaveLength(2);
    const mid = styleOf(group);
    expect(mid.rotate).toBeLessThan(0);
    expect(mid.rotate).toBeGreaterThan(Beaten.rotateDeg);
    expect(mid.opacity).toBe(1);
    const shades = within(group).getAllByTestId("beaten-shade", HIDDEN);
    expect(shades).toHaveLength(2);
    for (const s of shades) expect(styleOf(s).opacity).toBeGreaterThan(0);

    await step(Motion.beaten);
    const done = styleOf(group);
    expect(within(group).getAllByTestId("flying-card", HIDDEN)).toHaveLength(2);
    expect(done).toEqual({ opacity: 1, rotate: Beaten.rotateDeg, drop: Beaten.drop });
    for (const s of shades) expect(styleOf(s).opacity).toBe(1);
    await r.unmount();
  });

  it("takes the pose at once under reduced motion", async () => {
    jest.useFakeTimers();
    setMotionPreference("on");
    const r = await beatMidFlight();
    await step(0);

    const group = screen.getByTestId("pile-prev-layer", HIDDEN);
    expect(styleOf(group)).toEqual({ opacity: 1, rotate: Beaten.rotateDeg, drop: Beaten.drop });
    await r.unmount();
  });
});
