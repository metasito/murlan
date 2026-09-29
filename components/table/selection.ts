export type SelectionMode = "play" | "exchange";

export interface Selection {
  mode: SelectionMode;
  ids: string[];
}

export const NO_SELECTION: Selection = { mode: "play", ids: [] };

export function inMode(selection: Selection, mode: SelectionMode): Selection {
  return selection.mode === mode ? selection : { mode, ids: [] };
}

export function press(selection: Selection, id: string, mode: SelectionMode): Selection {
  const { ids } = inMode(selection, mode);
  if (mode === "exchange") return { mode, ids: ids[0] === id ? [] : [id] };
  return { mode, ids: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id] };
}

export function followHand(
  selection: Selection,
  before: readonly string[],
  after: readonly string[]
): Selection {
  const had = new Set(before);
  if (after.some((id) => !had.has(id))) {
    return selection.ids.length === 0 ? selection : { mode: selection.mode, ids: [] };
  }
  const held = new Set(after);
  const kept = selection.ids.filter((id) => held.has(id));
  return kept.length === selection.ids.length ? selection : { mode: selection.mode, ids: kept };
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
