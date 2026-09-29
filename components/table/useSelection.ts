import { useCallback, useEffect, useState } from "react";
import { useDerivedValue, useSharedValue, type DerivedValue, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN, scheduleOnUI } from "react-native-worklets";
import { press, settle, type Selection, type SelectionMode, type SelectionStore } from "./selection";

export interface HandSelection {
  /** The settled selection's ids on the UI thread, ahead of the store while a tap is on its way to it. */
  shown: DerivedValue<string[]>;
  /** A worklet: the tap, on the UI thread. */
  tap: (id: string) => void;
}

function uiMirror(store: SelectionStore, sel: SharedValue<Selection>) {
  let published: Selection | null = null;
  return {
    publish: (next: Selection, id: string, announce: (next: Selection, id: string) => void) => {
      published = next;
      announce(next, id);
    },
    follow: () =>
      store.subscribe(() => {
        const now = store.get();
        if (now !== published) sel.set(now);
      }),
  };
}

/**
 * The selection a finger writes on the UI thread. `announce` puts a tap's result in the store; every
 * other write to the store reaches the UI thread through it.
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
  const [mirror] = useState(() => uiMirror(store, sel));
  useEffect(() => mirror.follow(), [mirror]);
  useEffect(() => {
    held.set(hand);
    current.set(mode);
    on.set(enabled);
  }, [hand, mode, enabled, held, current, on]);

  const shown = useDerivedValue(() => settle(sel.value, held.value, current.value).ids);
  const publish = useCallback((next: Selection, id: string) => mirror.publish(next, id, announce), [mirror, announce]);
  const tap = useCallback(
    (id: string) => {
      'worklet';
      if (!on.value) return;
      const next = press(settle(sel.value, held.value, current.value), id);
      sel.set(next);
      scheduleOnRN(publish, next, id);
    },
    [on, sel, held, current, publish]
  );
  const tapFromJs = useCallback((id: string) => scheduleOnUI(tap, id), [tap]);
  return { shown, tap, tapFromJs };
}
