export type SelectionMode = "play" | "exchange";

export interface Selection {
  mode: SelectionMode;
  ids: string[];
  held: readonly string[];
}

export const NO_SELECTION: Selection = { mode: "play", ids: [], held: [] };

function followHand(selection: Selection, hand: readonly string[]): Selection {
  const had = new Set(selection.held);
  if (hand.some((id) => !had.has(id))) return { mode: selection.mode, ids: [], held: hand };
  if (hand.length === selection.held.length) return selection;
  const kept = new Set(hand);
  return { mode: selection.mode, ids: selection.ids.filter((id) => kept.has(id)), held: hand };
}

export function settle(selection: Selection, hand: readonly string[], mode: SelectionMode): Selection {
  const followed = followHand(selection, hand);
  return followed.mode === mode ? followed : { mode, ids: [], held: followed.held };
}

export function press(selection: Selection, id: string): Selection {
  const { mode, ids, held } = selection;
  if (mode === "exchange") return { mode, ids: ids[0] === id ? [] : [id], held };
  return { mode, ids: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id], held };
}

export interface SelectionStore {
  get: () => Selection;
  set: (next: Selection) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createSelectionStore(initial: Selection = NO_SELECTION): SelectionStore {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set: (next) => {
      if (next === current) return;
      current = next;
      listeners.forEach((l) => l());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
