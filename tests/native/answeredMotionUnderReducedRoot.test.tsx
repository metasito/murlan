import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, render, screen } from "@testing-library/react-native";
import type { TestInstance } from "test-renderer";
import { ReduceMotion, ReducedMotionConfig, getAnimatedStyle } from "react-native-reanimated";
import { setMotionPreference } from "@/lib/accessibility";
import { FloatingReactions } from "@/components/ReactionLayer";
import { clearReactions, pushReaction } from "@/lib/reactions";
import { pileOf } from "./helpers/landing";

const { getReducedMotionFromConfig } = require("react-native-reanimated/lib/module/layoutReanimation/web") as {
  getReducedMotionFromConfig: (layoutAnimation: unknown) => boolean;
};
const advance = (ms: number) => act(async () => void jest.advanceTimersByTime(ms));
const underReducedRoot = (children: React.ReactNode) => (
  <>
    <ReducedMotionConfig mode={ReduceMotion.Always} />
    {children}
  </>
);

beforeEach(() => {
  jest.useFakeTimers();
  setMotionPreference("on");
});
afterEach(() => {
  jest.useRealTimers();
  setMotionPreference("system");
});

describe("under the app's reduced motion, an animation that answers it plays its reduced form", () => {

  it("a table reaction shows, then fades, rather than its sequence skipping to the fade's end", async () => {
    const view = await render(underReducedRoot(<FloatingReactions viewerSeat={0} playerCount={4} />));
    await act(async () => pushReaction({ emoji: "🔥", username: "Ana", fromSeat: 2 }));
    await advance(100);
    expect((getAnimatedStyle(screen.getByTestId("reaction-from-2")) as { opacity: number }).opacity).toBeGreaterThan(0.5);
    await act(async () => clearReactions());
    await view.unmount();
  });

  it("the round winner's tag keeps its fade out rather than vanishing", async () => {
    const view = await render(underReducedRoot(pileOf({ comboLabel: null, roundWinner: "Ana" })));
    let host: TestInstance | null = screen.getByTestId("notice-roundWinner");
    while (host && !host.props.exiting) host = host.parent;
    expect(host).not.toBeNull();
    expect(getReducedMotionFromConfig(host!.props.exiting)).toBe(false);
    await view.unmount();
  });
});
