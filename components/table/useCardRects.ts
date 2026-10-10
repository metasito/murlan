import { createContext, useContext, useEffect, useLayoutEffect, useMemo } from "react";
import { makeMutable, startMapper, stopMapper, useSharedValue, type SharedValue } from "react-native-reanimated";
import type { OpponentSide } from "@/components/seatLayout";
import { designRect, type CardRect, type CardRects, type DrawnCard, type Felt, type Point, type TableMotion } from "./cardRects";
import type { Lamp } from "./lampRig";

/**
 * The one registry, and the laid-out places every owner measures its cards from, in window points.
 * A publisher's `read` takes the places and never `rects`: a mapper re-runs on every shared value its
 * closure reaches, so one reaching the registry would re-run on every other card's write.
 */
export interface CardTable {
  rects: SharedValue<CardRects>;
  felt: Felt;
  motion: SharedValue<TableMotion>;
  pile: Point;
  /** The hand zone's centre before its lift. */
  hand: Point;
  seats: Record<OpponentSide, Point>;
  handLift: SharedValue<number>;
  lamp: SharedValue<Lamp>;
}

const CardTableContext = createContext<CardTable | null>(null);
export const CardTableProvider = CardTableContext.Provider;

export function useCardTable(): CardTable | null {
  return useContext(CardTableContext);
}

type Places = Pick<CardTable, "pile" | "hand" | "seats" | "felt">;

export function useCardTableValue(places: Places, motion: SharedValue<TableMotion>, handLift: SharedValue<number>, lamp: SharedValue<Lamp>): CardTable {
  const rects = useSharedValue<CardRects>({});
  const key = JSON.stringify(places);
  useEffect(() => {
    if (process.env.EXPO_PUBLIC_E2E_FAST !== "1") return;
    const e2e = globalThis as { murlanCardRects?: () => CardRects; murlanCardFelt?: () => Felt; murlanCardPile?: () => Places["pile"] };
    const read = () => ({ ...rects.get() });
    const felt = () => (JSON.parse(key) as Places).felt;
    const pile = () => (JSON.parse(key) as Places).pile;
    e2e.murlanCardRects = read;
    e2e.murlanCardFelt = felt;
    e2e.murlanCardPile = pile;
    return () => {
      if (e2e.murlanCardRects === read) delete e2e.murlanCardRects;
      if (e2e.murlanCardFelt === felt) delete e2e.murlanCardFelt;
      if (e2e.murlanCardPile === pile) delete e2e.murlanCardPile;
    };
  }, [rects, key]);
  return useMemo(() => ({ ...(JSON.parse(key) as Places), rects, motion, handLift, lamp }), [key, rects, motion, handLift, lamp]);
}

function forget(rects: SharedValue<CardRects>, key: string, prefix: boolean) {
  rects.modify((r) => {
    "worklet";
    for (const k of Object.keys(r)) if (prefix ? k.startsWith(key) : k === key) delete r[k];
    return r;
  });
}

/**
 * Publishes one card from the UI thread whenever a shared value `read` reaches moves; null while it is
 * not drawn. A commit queues its writes in order — the last run's forget, then this run's rect, read on
 * the UI thread from values the commit has already set — so a card still drawn is never left out once
 * the UI thread has run them. On native nothing on JS sees them within the commit.
 */
export function useCardRect(table: CardTable | null, key: string, drawn: boolean, read: () => CardRect | null): void {
  const rects = table?.rects;
  useLayoutEffect(() => {
    if (!rects) return;
    if (!drawn) return forget(rects, key, false);
    const alive = makeMutable(true);
    const publish = () => {
      "worklet";
      // A new object on a change and `r` itself on none: with `forceUpdate` off, only a change notifies.
      rects.modify((r) => {
        "worklet";
        const rect = alive.value ? read() : null;
        if (!alive.value || sameRect(r[key], rect)) return r;
        const next = { ...r };
        if (rect) next[key] = rect;
        else delete next[key];
        return next;
      }, false);
    };
    publish();
    const mapper = startMapper(publish, Object.values((read as { __closure?: Record<string, unknown> }).__closure ?? {}));
    return () => {
      alive.value = false;
      stopMapper(mapper);
      forget(rects, key, false);
    };
  }, [rects, key, drawn, read]);
}

function sameRect(a: CardRect | undefined, b: CardRect | null): boolean {
  "worklet";
  if (!a || !b) return !a && !b;
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h && a.rot === b.rot && a.back === b.back && a.lift === b.lift && a.glow === b.glow && a.seen === b.seen;
}

/** Publishes cards laid out by a render, all under `prefix`: replaced in the commit that draws them, moved with the table. */
export function useStaticCardRects(table: CardTable | null, prefix: string, cards: readonly DrawnCard[]): void {
  const rects = table?.rects;
  const felt = table?.felt;
  const motion = table?.motion;
  useLayoutEffect(() => {
    if (!rects || !felt || !motion) return;
    const alive = makeMutable(true);
    const publish = () => {
      "worklet";
      rects.modify((r) => {
        "worklet";
        if (!alive.value) return r;
        for (const k of Object.keys(r)) if (k.startsWith(prefix)) delete r[k];
        cards.forEach((c, i) => {
          r[`${prefix}${i}`] = designRect(c, felt, motion.value);
        });
        return r;
      });
    };
    publish();
    const mapper = startMapper(publish, [motion]);
    return () => {
      alive.value = false;
      stopMapper(mapper);
      forget(rects, prefix, true);
    };
  }, [rects, felt, motion, prefix, cards]);
}
