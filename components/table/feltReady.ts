import { createContext, useCallback, useLayoutEffect, useState, useSyncExternalStore, type ComponentRef, type RefObject } from "react";
import { Platform, type View } from "react-native";
import type { SharedValue } from "react-native-reanimated";
import type { FeltStops } from "@/lib/cosmetics";
import { E2E_FAST } from "@/lib/e2eConfig";
import { TABLE_CAST } from "@/lib/theme";
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
 * `table`, a static shadow cast at the offset the table's root holds (`TABLE_CAST`). Off the table,
 * null: a static shadow.
 */
export type CardCast = "felt" | "table";
export const CardCastContext = createContext<CardCast | null>(null);

/** Sets the cast on `root` itself, so a new offset restyles one view and re-renders no card. */
export function useCardCast(ready: boolean, { x, y }: Point, root: RefObject<ComponentRef<typeof View> | null>): CardCast {
  const cast = Platform.OS !== "web" || ready ? "felt" : "table";
  useLayoutEffect(() => {
    const style = (root.current as unknown as HTMLElement | null)?.style;
    if (cast !== "table" || !style) return;
    style.setProperty(TABLE_CAST.x, `${x}px`);
    style.setProperty(TABLE_CAST.y, `${y}px`);
  }, [cast, x, y, root]);
  return cast;
}

let shadowsOn = true;
const shadowListeners = new Set<() => void>();
const onShadows = (listener: () => void) => {
  shadowListeners.add(listener);
  return () => void shadowListeners.delete(listener);
};
if (E2E_FAST) {
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
