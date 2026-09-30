import { useCallback, useLayoutEffect, useRef } from "react";
import { useDerivedValue, useSharedValue, type DerivedValue } from "react-native-reanimated";
import { scheduleOnRN, scheduleOnUI } from "react-native-worklets";
import { press, settle, type Selection, type SelectionMode, type SelectionStore } from "./selection";

export interface HandSelection {
  /** The settled selection's ids on the UI thread, ahead of the store while a tap is on its way to it. */
  shown: DerivedValue<string[]>;
  /** A worklet: the tap, on the UI thread. */
  tap: (id: string) => void;
}

/**
 * The selection a finger writes on the UI thread. The UI value is a prediction: the store stays the
 * authority, so a tap is re-based on the store when it reaches JS and the UI value corrected to it.
 */
export function useSelection(
  store: SelectionStore,
  hand: readonly string[],
  mode: SelectionMode,
  enabled: boolean,
  announce: (next: Selection, id: string) => void
): HandSelection & { tapFromJs: (id: string) => void } {
  const sel = useSharedValue<Selection>(store.get());
  const held = useSharedValue<readonly string[]>(hand);
  const current = useSharedValue<SelectionMode>(mode);
  const on = useSharedValue(enabled);
  const taps = useSharedValue(0);
  const live = useRef({ hand, mode, enabled, announce });
  const published = useRef<Selection | null>(null);

  useLayoutEffect(() => {
    live.current = { hand, mode, enabled, announce };
    held.set(hand);
    current.set(mode);
    on.set(enabled);
  }, [hand, mode, enabled, announce, held, current, on]);
  useLayoutEffect(
    () =>
      store.subscribe(() => {
        const now = store.get();
        if (now !== published.current) sel.set(now);
      }),
    [store, sel]
  );

  const shown = useDerivedValue(() => settle(sel.value, held.value, current.value).ids);
  const correct = useCallback(
    (next: Selection, seq: number) => {
      'worklet';
      if (taps.value === seq) sel.set(next);
    },
    [taps, sel]
  );
  const publish = useCallback(
    (id: string, seq: number) => {
      const now = live.current;
      if (now.enabled) {
        const next = press(settle(store.get(), now.hand, now.mode), id);
        published.current = next;
        now.announce(next, id);
      }
      scheduleOnUI(correct, store.get(), seq);
    },
    [store, correct]
  );
  const tap = useCallback(
    (id: string) => {
      'worklet';
      if (!on.value) return;
      const seq = taps.value + 1;
      taps.set(seq);
      sel.set(press(settle(sel.value, held.value, current.value), id));
      scheduleOnRN(publish, id, seq);
    },
    [on, taps, sel, held, current, publish]
  );
  const tapFromJs = useCallback((id: string) => scheduleOnUI(tap, id), [tap]);
  return { shown, tap, tapFromJs };
}
