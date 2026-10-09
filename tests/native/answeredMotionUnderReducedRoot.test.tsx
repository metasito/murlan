import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, render, screen } from "@testing-library/react-native";
import type { TestInstance } from "test-renderer";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ReduceMotion, ReducedMotionConfig, getAnimatedStyle } from "react-native-reanimated";
import { setMotionPreference } from "@/lib/accessibility";
import { Motion } from "@/lib/theme";
import { ResultBoard } from "@/components/ResultBoard";
import { pileOf } from "./helpers/landing";

const { getReducedMotionFromConfig } = require("react-native-reanimated/lib/module/layoutReanimation/web") as {
  getReducedMotionFromConfig: (layoutAnimation: unknown) => boolean;
};
const METRICS ={ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
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
  it("the winner's celebration fades in over its 200 ms reduced reveal, not at once", async () => {
    const view = await render(
      underReducedRoot(
        <SafeAreaProvider initialMetrics={METRICS}>
          <ResultBoard
            headerTitle="HAND OVER"
            formatLine="First to 21"
            celebratedName="Ana"
            celebrationSubtitle="WINS THE HAND"
            viewerCelebrated
            matchOver={false}
            rows={[{ id: "player_0", name: "Ana", total: 3, points: 3 }]}
            handCount={1}
            target={21}
            teams={false}
            home={{ label: "Home", onPress: () => {} }}
            topPad={0}
            bottomPad={0}
            leftPad={0}
            rightPad={0}
          />
        </SafeAreaProvider>
      )
    );
    const opacity = () => (getAnimatedStyle(screen.getByTestId("winner-celebration")) as { opacity: number }).opacity;
    await advance(Motion.reduced.reveal / 2);
    expect(opacity()).toBeGreaterThan(0);
    expect(opacity()).toBeLessThan(1);
    await advance(Motion.reduced.reveal);
    expect(opacity()).toBe(1);
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
