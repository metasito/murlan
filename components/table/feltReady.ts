import { createContext, useCallback, useLayoutEffect, useState, useSyncExternalStore, type ComponentRef } from "react";
import { Platform, type View } from "react-native";
import type { SharedValue } from "react-native-reanimated";
import type { FeltStops } from "@/lib/cosmetics";
import { E2E_FAST } from "@/lib/e2eConfig";
import { drawsBoxShadow, TABLE_CAST } from "@/lib/theme";
import { useTraceSource } from "@/lib/e2eTrace";
import { feltContactPaths, viewContact, type ShadowKind, type ShadowPath } from "./cardShadows";
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
 * How a card view on the table shades itself: `felt` where the felt draws every card's cast and the
 * view its contact alone (`cardContacts`), else `table`, a static shadow cast at the offset the
 * table's root holds (`TABLE_CAST`). Off the table, null: a static shadow.
 */
export type CardCast = "felt" | "table";

/** Who draws a table card's contact on this platform: `view`, the contact a card's own view draws, or null; `felt`, the paths that leaves the felt. */
export function cardContacts(): CardContacts {
  return BY_BOX_SHADOW[Number(drawsBoxShadow())];
}
type CardContacts = { view: (kind: ShadowKind) => "face" | "back" | null; felt: ShadowPath[] };
const BY_BOX_SHADOW: CardContacts[] = [false, true].map((boxShadow) => ({ view: (kind) => viewContact(kind, boxShadow), felt: feltContactPaths(boxShadow) }));
export const CardCastContext = createContext<CardCast | null>(null);

/** The cast, and the ref for the table's root: the offset is set on that one view, so a new one re-renders no card. */
export function useCardCast(ready: boolean, { x, y }: Point): [CardCast, (root: ComponentRef<typeof View> | null) => void] {
  const cast = Platform.OS !== "web" || ready ? "felt" : "table";
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const attach = useCallback((node: ComponentRef<typeof View> | null) => setRoot(node as unknown as HTMLElement | null), []);
  useLayoutEffect(() => {
    if (cast !== "table" || !root?.style) return;
    root.style.setProperty(TABLE_CAST.x, `${x}px`);
    root.style.setProperty(TABLE_CAST.y, `${y}px`);
  }, [cast, x, y, root]);
  return [cast, attach];
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
