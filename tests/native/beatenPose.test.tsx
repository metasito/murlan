// tests/native/beatenPose.test.tsx — a play takes the beaten pose from the throw that beats it,
// on its own views, even while they are still in the air (D4 #5, task 4's review M2).
import { describe, it, expect, jest, afterEach } from "@jest/globals";
import { act, render, screen, within } from "@testing-library/react-native";
import { Easing, getAnimatedStyle, makeMutable } from "react-native-reanimated";
import { NO_LANDING } from "@/components/table/useFlightClock";
import { card, fireLanding, flightOf, pileOf } from "./helpers/landing";
import { setMotionPreference } from "@/lib/accessibility";
import { Beaten, Motion } from "@/lib/theme";

const HIDDEN = { includeHiddenElements: true };
const FRAME = 16;
const FROM = { x: -180, y: 160, rot: 24, scale: 1.2 };
const A = flightOf("a", [card("a1", "3", "clubs"), card("a2", "3", "hearts")], [FROM, FROM]);
const B = flightOf("b", [card("b1", "4", "clubs"), card("b2", "4", "hearts")], [FROM, FROM]);
const C = flightOf("c", [card("c1", "5", "clubs"), card("c2", "5", "hearts")], [FROM, FROM]);
const easeOut = Easing.bezierFn(0, 0, 0.58, 1);
const RESTING = { opacity: 1, rotate: Beaten.rotateDeg, drop: Beaten.drop };

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
  const view = await render(pileOf({ plays: [A], flights: [A], signal }));
  await step(FRAME);
  await view.rerender(pileOf({ plays: [A, B], flights: [A, B], signal }));
  return { view, signal };
}

const step = (ms: number) => act(async () => void jest.advanceTimersByTime(ms));
const beatenGroup = () => screen.getByTestId("pile-prev-layer", HIDDEN);
const turnOf = () => styleOf(beatenGroup()).rotate / Beaten.rotateDeg;

afterEach(() => {
  setMotionPreference("system");
  jest.useRealTimers();
});

describe("the beaten pose (D4 #5)", () => {
  it("turns a play still in the air over the mockup's ease-out, and hands it to the felt unchanged", async () => {
    jest.useFakeTimers();
    const { view, signal } = await beatMidFlight();
    await step(Motion.beaten / 2);

    const group = beatenGroup();
    expect(within(group).getAllByTestId("flying-card", HIDDEN)).toHaveLength(2);
    const k = turnOf();
    expect(k).toBeGreaterThanOrEqual(easeOut((Motion.beaten / 2 - FRAME) / Motion.beaten));
    expect(k).toBeLessThanOrEqual(easeOut((Motion.beaten / 2 + FRAME) / Motion.beaten));
    expect(styleOf(group).opacity).toBe(1);
    const shades = within(group).getAllByTestId("beaten-shade", HIDDEN);
    expect(shades).toHaveLength(2);
    for (const s of shades) expect(styleOf(s).opacity).toBeCloseTo(k, 6);

    await step(Motion.beaten / 2 - 2 * FRAME);
    expect(turnOf()).toBeLessThan(1);
    await step(2 * FRAME);
    expect(styleOf(group)).toEqual(RESTING);
    for (const s of shades) expect(styleOf(s).opacity).toBe(1);

    await step(A.spec.end);
    await view.rerender(pileOf({ plays: [A, B], flights: [B], signal }));
    await step(FRAME);
    expect(within(beatenGroup()).queryAllByTestId("flying-card", HIDDEN)).toHaveLength(0);
    expect(styleOf(beatenGroup())).toEqual(RESTING);
    await view.unmount();
  });

  it("is knocked by the play that lands on it, never by its own landing", async () => {
    jest.useFakeTimers();
    const { view, signal } = await beatMidFlight();
    await step(Motion.beaten + FRAME);

    await act(async () => fireLanding(signal, { cards: 4, heavy: true, key: A.key }));
    await step(Motion.duration.flash / 2);
    expect(styleOf(beatenGroup()).drop).toBe(Beaten.drop);

    await step(A.spec.end);
    await view.rerender(pileOf({ plays: [A, B], flights: [B], signal }));
    await act(async () => fireLanding(signal, { cards: 4, heavy: true, key: B.key }));
    await step(Motion.duration.flash / 2);
    expect(styleOf(beatenGroup()).drop).toBeGreaterThan(Beaten.drop);
    await view.unmount();
  });

  it("keeps its turn when a third throw buries it in the air", async () => {
    jest.useFakeTimers();
    const { view, signal } = await beatMidFlight();
    await step(2 * FRAME);
    await view.rerender(pileOf({ plays: [A, B, C], flights: [A, B, C], signal }));
    await step(Motion.beaten + FRAME);

    expect(styleOf(screen.getByTestId("pile-buried-layer", HIDDEN)).rotate).toBe(Beaten.rotateDeg);
    await view.unmount();
  });

  it("takes the pose at once under reduced motion", async () => {
    jest.useFakeTimers();
    setMotionPreference("on");
    const { view } = await beatMidFlight();
    await step(0);

    expect(styleOf(beatenGroup())).toEqual(RESTING);
    await view.unmount();
  });
});
