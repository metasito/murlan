import { createContext, useCallback, useMemo, useState } from "react";
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
