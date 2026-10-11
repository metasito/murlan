import { createContext, useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { Platform } from "react-native";
import type { SharedValue } from "react-native-reanimated";
import type { FeltStops } from "@/lib/cosmetics";
import { useTraceSource } from "@/lib/e2eTrace";
import type { CardTable } from "./useCardRects";
import type { Point } from "./cardRects";
import type { Pool } from "./lampRig";
import type { LampRig } from "./useLampRig";

export interface FeltProps {
  rig: LampRig;
  stops: FeltStops;
  /** Where the lamp is headed: the web fallback bakes its light there. */
  pool: Pool;
  ready: boolean;
  onReady: () => void;
  cards: CardTable;
  grey?: SharedValue<number>;
}

export interface HandShadeProps {
  lamp: LampRig["lamp"];
  cards: CardTable;
  /** The Skia felt has drawn: the card views have given their own shadows up to the felt. */
  ready: boolean;
}

/**
 * How a card view on the table shades itself: `felt` where the felt draws every card's shadow, else
 * today's static shadow cast at this offset. Off the table, null: a static shadow.
 */
export type CardCast = "felt" | Point;
export const CardCastContext = createContext<CardCast | null>(null);

/** One value per offset, so the table's card views re-render only when the seat on move changes it. */
export function useCardCast(ready: boolean, { x, y }: Point): CardCast {
  return useMemo(() => (Platform.OS !== "web" || ready ? "felt" : { x, y }), [ready, x, y]);
}

let shadowsOn = true;
const shadowListeners = new Set<() => void>();
const onShadows = (listener: () => void) => {
  shadowListeners.add(listener);
  return () => void shadowListeners.delete(listener);
};
if (process.env.EXPO_PUBLIC_E2E_FAST === "1") {
  (globalThis as { murlanCardShadows?: (on: boolean) => void }).murlanCardShadows = (on) => {
    shadowsOn = on;
    for (const listener of shadowListeners) listener();
  };
}

/** Whether the table's Skia card shadows draw: always, but where an e2e spec switches them off. */
export function useCardShadowsOn(): boolean {
  return useSyncExternalStore(onShadows, () => shadowsOn);
}

/** Skia's readiness — loaded and its first frame drawn — for the trace; game information never waits on it. */
export function useFeltReady(): [boolean, () => void] {
  const [ready, setReady] = useState(false);
  const onReady = useCallback(() => setReady(true), []);
  useTraceSource(
    "felt",
    useCallback(() => (ready ? "skia" : "fallback"), [ready])
  );
  return [ready, onReady];
}
