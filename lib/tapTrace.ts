import { useSyncExternalStore } from "react";

const lines: string[] = [];
let snapshot = "";
const listeners = new Set<() => void>();
const t0 = Date.now();

export function traceTap(msg: string): void {
  lines.push(`${Date.now() - t0}:${msg}`);
  if (lines.length > 40) lines.shift();
  snapshot = lines.join(" | ");
  console.error(`TAPTRACE ${msg}`);
  listeners.forEach((l) => l());
}

export function useTapTrace(): string {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot,
    () => snapshot
  );
}
