import { createContext, useContext, useEffect, useMemo, type DependencyList } from "react";
import { useAnimatedReaction, useSharedValue, type SharedValue } from "react-native-reanimated";
import type { OpponentSide } from "@/components/seatLayout";
import type { CardRect, CardRects, Felt, Point } from "./cardRects";

/** The one registry, and the laid-out places every owner measures its cards from, in window points. */
export interface CardTable extends Felt {
  rects: SharedValue<CardRects>;
  pile: Point;
  /** The hand zone's centre before its lift. */
  hand: Point;
  seats: Record<OpponentSide, Point>;
  handLift: SharedValue<number>;
}

const CardTableContext = createContext<CardTable | null>(null);
export const CardTableProvider = CardTableContext.Provider;

export function useCardTable(): CardTable | null {
  return useContext(CardTableContext);
}

type Places = Pick<CardTable, "pile" | "hand" | "seats">;

export function useCardTableValue(places: Places, felt: Felt, handLift: SharedValue<number>): CardTable {
  const rects = useSharedValue<CardRects>({});
  const key = JSON.stringify(places);
  const { sx, sy } = felt;
  useEffect(() => {
    if (process.env.EXPO_PUBLIC_E2E_FAST !== "1") return;
    const e2e = globalThis as { murlanCardRects?: () => CardRects };
    const read = () => ({ ...rects.get() });
    e2e.murlanCardRects = read;
    return () => {
      if (e2e.murlanCardRects === read) delete e2e.murlanCardRects;
    };
  }, [rects]);
  return useMemo(() => ({ ...(JSON.parse(key) as Places), sx, sy, rects, handLift }), [key, sx, sy, rects, handLift]);
}

function forget(rects: SharedValue<CardRects>, key: string, prefix: boolean) {
  rects.modify((r) => {
    "worklet";
    for (const k of Object.keys(r)) if (prefix ? k.startsWith(key) : k === key) delete r[k];
    return r;
  });
}

/** Publishes one card from the UI thread whenever what `read` reads moves; null while it is not drawn. */
export function useCardRect(table: CardTable | null, key: string, read: () => CardRect | null, deps: DependencyList): void {
  const rects = table?.rects;
  useAnimatedReaction(
    read,
    (rect) => {
      if (!rects) return;
      rects.modify((r) => {
        "worklet";
        if (rect) r[key] = rect;
        else delete r[key];
        return r;
      });
    },
    [rects, key, ...deps]
  );
  useEffect(() => {
    if (!rects) return;
    return () => forget(rects, key, false);
  }, [rects, key]);
}

/** Publishes cards that move only with a render, all under `prefix`, replacing the last set in one write. */
export function useStaticCardRects(table: CardTable | null, prefix: string, cards: readonly CardRect[]): void {
  const rects = table?.rects;
  useEffect(() => {
    if (!rects) return;
    rects.modify((r) => {
      "worklet";
      for (const k of Object.keys(r)) if (k.startsWith(prefix)) delete r[k];
      cards.forEach((c, i) => {
        r[`${prefix}${i}`] = c;
      });
      return r;
    });
  }, [rects, prefix, cards]);
  useEffect(() => {
    if (!rects) return;
    return () => forget(rects, prefix, true);
  }, [rects, prefix]);
}
