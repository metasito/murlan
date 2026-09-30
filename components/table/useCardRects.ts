import { createContext, useContext, useEffect, useLayoutEffect, useMemo } from "react";
import { makeMutable, startMapper, stopMapper, useSharedValue, type SharedValue } from "react-native-reanimated";
import type { OpponentSide } from "@/components/seatLayout";
import { designRect, type CardRect, type CardRects, type DrawnCard, type Felt, type Point, type TableMotion } from "./cardRects";

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
}

const CardTableContext = createContext<CardTable | null>(null);
export const CardTableProvider = CardTableContext.Provider;

export function useCardTable(): CardTable | null {
  return useContext(CardTableContext);
}

type Places = Pick<CardTable, "pile" | "hand" | "seats" | "felt">;

export function useCardTableValue(places: Places, motion: SharedValue<TableMotion>, handLift: SharedValue<number>): CardTable {
  const rects = useSharedValue<CardRects>({});
  const key = JSON.stringify(places);
  useEffect(() => {
    if (process.env.EXPO_PUBLIC_E2E_FAST !== "1") return;
    const e2e = globalThis as { murlanCardRects?: () => CardRects; murlanCardFelt?: () => Felt };
    const read = () => ({ ...rects.get() });
    const felt = () => (JSON.parse(key) as Places).felt;
    e2e.murlanCardRects = read;
    e2e.murlanCardFelt = felt;
    return () => {
      if (e2e.murlanCardRects === read) delete e2e.murlanCardRects;
      if (e2e.murlanCardFelt === felt) delete e2e.murlanCardFelt;
    };
  }, [rects, key]);
  return useMemo(() => ({ ...(JSON.parse(key) as Places), rects, motion, handLift }), [key, rects, motion, handLift]);
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
 * not drawn. The mapper starts and stops with the commit, never a frame after it: a view that draws or
 * leaves in a commit has its rect written or cleared in that same commit.
 */
export function useCardRect(table: CardTable | null, key: string, drawn: boolean, read: () => CardRect | null): void {
  const rects = table?.rects;
  useLayoutEffect(() => {
    if (!rects) return;
    if (!drawn) return forget(rects, key, false);
    const alive = makeMutable(true);
    const publish = (rect: CardRect | null) => {
      "worklet";
      if (!alive.value || (!rect && rects.value[key] === undefined)) return;
      rects.modify((r) => {
        "worklet";
        if (rect) r[key] = rect;
        else delete r[key];
        return r;
      });
    };
    const first = read();
    if (!sameRect(rects.get()[key], first)) publish(first);
    const mapper = startMapper(() => {
      "worklet";
      publish(read());
    }, Object.values((read as { __closure?: Record<string, unknown> }).__closure ?? {}));
    return () => {
      alive.value = false;
      stopMapper(mapper);
      forget(rects, key, false);
    };
  }, [rects, key, drawn, read]);
}

function sameRect(a: CardRect | undefined, b: CardRect | null): boolean {
  if (!a || !b) return !a && !b;
  return (Object.keys(b) as (keyof CardRect)[]).every((k) => a[k] === b[k]);
}

/** Publishes cards laid out by a render, all under `prefix`: replaced in the commit that draws them, moved with the table. */
export function useStaticCardRects(table: CardTable | null, prefix: string, cards: readonly DrawnCard[]): void {
  const rects = table?.rects;
  const felt = table?.felt;
  const motion = table?.motion;
  useLayoutEffect(() => {
    if (!rects || !felt || !motion) return;
    const alive = makeMutable(true);
    const publish = (m: TableMotion) => {
      "worklet";
      if (!alive.value) return;
      rects.modify((r) => {
        "worklet";
        for (const k of Object.keys(r)) if (k.startsWith(prefix)) delete r[k];
        cards.forEach((c, i) => {
          r[`${prefix}${i}`] = designRect(c, felt, m);
        });
        return r;
      });
    };
    publish(motion.get());
    const mapper = startMapper(() => {
      "worklet";
      publish(motion.value);
    }, [motion]);
    return () => {
      alive.value = false;
      stopMapper(mapper);
      forget(rects, prefix, true);
    };
  }, [rects, felt, motion, prefix, cards]);
}
