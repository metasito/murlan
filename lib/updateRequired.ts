import { useSyncExternalStore } from "react";

let required = false;
const listeners = new Set<() => void>();

/** One-way: nothing short of a reload makes this bundle able to talk to the server again. */
export function requireUpdate(): void {
  if (required) return;
  required = true;
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useUpdateRequired(): boolean {
  return useSyncExternalStore(subscribe, () => required);
}
