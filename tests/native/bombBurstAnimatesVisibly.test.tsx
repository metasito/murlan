// tests/native/bombBurstAnimatesVisibly.test.tsx — a blind critique on #765's
// own review deleted every animated assignment inside `Flare`'s effect body
// (keeping the reduced-motion guard, so the landing still arrives and the
// wiring tests in tests/native/lampFlareWiring.test.tsx still pass) and every
// test in this repo stayed green, native and node both. Those tests assert
// the trigger produces a *call*; none of them assert it produces a *visible
// value*. This file reads the rendered animated style back the way
// tests/native/pileFlinch.test.tsx does, so an inert effect body reds here
// even when the wiring around it is perfect.
import { describe, it, expect, jest } from "@jest/globals";
import React from "react";
import { Platform, StyleSheet } from "react-native";
import { act, render, screen } from "@testing-library/react-native";
import { getAnimatedStyle, makeMutable, type SharedValue } from "react-native-reanimated";
import type { ImpactTier } from "@/components/flightPhysics";
import { Motion } from "@/lib/theme";
import { BombBurst, Sweep } from "@/components/table/moments";
import { NO_LANDING, type LandingSignal } from "@/components/table/useFlightClock";
import { fireLanding } from "./helpers/landing";

async function landed(ui: (landing: SharedValue<LandingSignal>) => React.ReactElement, tier: ImpactTier) {
  const landing = makeMutable(NO_LANDING);
  const r = await render(ui(landing));
  await act(async () => {
    jest.advanceTimersByTime(16);
    fireLanding(landing, { cards: 4, tier });
  });
  return r;
}

function transformOf(testID: string): Record<string, unknown>[] {
  const node = screen.getByTestId(testID);
  const style = getAnimatedStyle(node) as { transform?: Record<string, unknown>[] };
  return Array.isArray(style.transform) ? style.transform : [];
}

function opacityOf(testID: string): number {
  const node = screen.getByTestId(testID);
  const style = getAnimatedStyle(node) as { opacity?: number };
  return style.opacity ?? 0;
}

function entry(transform: Record<string, unknown>[], key: string) {
  return transform.find((t) => key in t);
}

describe("the bomb burst actually moves once fired (#765)", () => {
  it("the flare's opacity and scale leave their rest values partway through a bomb's own window", async () => {
    jest.useFakeTimers();
    const r = await landed((landing) => <BombBurst landing={landing} scale={1} />, "bomb");

    // Solidly inside the flare's first leg (6% of its 1500ms window) — well
    // before the sequence would settle back at either rest value.
    await act(async () => {
      jest.advanceTimersByTime(45);
      jest.runOnlyPendingTimers();
    });

    expect(opacityOf("bomb-flare")).toBeGreaterThan(0);
    const scale = entry(transformOf("bomb-flare"), "scale")?.scale as number;
    // Rest is 0.15 — a gutted effect body would leave it exactly there.
    expect(scale).toBeGreaterThan(0.15);

    jest.useRealTimers();
    await r.unmount();
  });

  it("both shockwave rings leave their rest opacity and scale, and no view draws a spark", async () => {
    jest.useFakeTimers();
    const r = await landed((landing) => <BombBurst landing={landing} scale={1} />, "bomb");

    await act(async () => {
      jest.advanceTimersByTime(Motion.duration.travel + 40);
      jest.runOnlyPendingTimers();
    });

    for (const ring of ["bomb-wave-0", "bomb-wave-1"]) {
      expect(opacityOf(ring)).toBeGreaterThan(0);
      expect(entry(transformOf(ring), "scale")?.scale as number).toBeGreaterThan(0.15);
    }
    expect(screen.queryAllByTestId(/^spark-/, { includeHiddenElements: true })).toHaveLength(0);

    jest.useRealTimers();
    await r.unmount();
  });
});

describe("the flare and the sweep screen onto the felt on native too (#1514)", () => {
  const blendOf = (testID: string) =>
    StyleSheet.flatten(screen.getByTestId(testID, { includeHiddenElements: true }).props.style).mixBlendMode;

  it(`the bomb flare carries mixBlendMode "screen" on ${Platform.OS}`, async () => {
    const r = await render(<BombBurst landing={makeMutable(NO_LANDING)} scale={1} />);
    expect(blendOf("bomb-flare")).toBe("screen");
    await r.unmount();
  });

  it(`the sweep carries mixBlendMode "screen" on ${Platform.OS}`, async () => {
    const r = await render(<Sweep trigger={1} width={200} height={100} />);
    expect(blendOf("sweep")).toBe("screen");
    await r.unmount();
  });
});
