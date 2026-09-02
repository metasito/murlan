// tests/native/bombBurstAnimatesVisibly.test.tsx — a blind critique on #765's
// own review deleted every animated assignment inside `Flare`'s effect body
// (keeping the reduced-motion guard, so `boomTrigger` still bumps and the
// wiring tests in tests/native/lampFlareWiring.test.tsx still pass) and every
// test in this repo stayed green, native and node both. Those tests assert
// the trigger produces a *call*; none of them assert it produces a *visible
// value*. This file reads the rendered animated style back the way
// tests/native/pileFlinch.test.tsx does, so an inert effect body reds here
// even when the wiring around it is perfect.
import { describe, it, expect, jest } from "@jest/globals";
import React from "react";
import { act, render, screen } from "@testing-library/react-native";
import { getAnimatedStyle } from "react-native-reanimated";
import { BombBurst, LampLift } from "@/components/table/moments";

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

describe("the bomb burst and the lamp lift actually move once fired (#765)", () => {
  it("the flare's opacity and scale leave their rest values partway through a bomb's own window", async () => {
    jest.useFakeTimers();
    const r = await render(<BombBurst trigger={1} scale={1} flareKind="brief" />);

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

  it("a spark's own opacity and translate leave their rest values once it flies", async () => {
    jest.useFakeTimers();
    const r = await render(<BombBurst trigger={1} scale={1} flareKind="brief" />);

    // Spark 0's own delay is 60ms (SPARK_LEAD_MS, i % 5 === 0) before its ramp
    // starts — past that, partway into the 10%-of-1150ms opacity ramp.
    await act(async () => {
      jest.advanceTimersByTime(60 + 50);
      jest.runOnlyPendingTimers();
    });

    expect(opacityOf("spark-0")).toBeGreaterThan(0);
    const translateX = entry(transformOf("spark-0"), "translateX")?.translateX as number;
    // Spark 0 flies straight out along +x (sparkOffset(0, 1).dx === 110) — a
    // gutted effect body would leave `progress` at 0 and this at exactly 0.
    expect(translateX).toBeGreaterThan(0);

    jest.useRealTimers();
    await r.unmount();
  });

  it("the lamp's own lift leaves its rest scale and opacity once it fires", async () => {
    jest.useFakeTimers();
    const r = await render(<LampLift trigger={1} scale={1} x={100} y={100} />);

    // Partway through the lift's own 900ms window — the opacity ramp's first
    // leg is 30% of it (270ms); the scale tween runs the whole window.
    await act(async () => {
      jest.advanceTimersByTime(100);
      jest.runOnlyPendingTimers();
    });

    expect(opacityOf("lamp-lift")).toBeGreaterThan(0);
    const scale = entry(transformOf("lamp-lift"), "scale")?.scale as number;
    // Rest is 0.7 (LIFT_SCALE_FROM) — a gutted effect body would leave it there.
    expect(scale).toBeGreaterThan(0.7);

    jest.useRealTimers();
    await r.unmount();
  });
});
