import { useEffect } from "react";
import type { DiagRow } from "./types";

export type { DiagRow, DiagRows } from "./types";

export const DIAGNOSTICS = process.env.EXPO_PUBLIC_DIAGNOSTICS === "1";

const recorder: { push(row: DiagRow): void } | null =
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- a static import would ship the recorder
  process.env.EXPO_PUBLIC_DIAGNOSTICS === "1" ? require("./recorder").recorder : null;

export function diag(row: DiagRow): void {
  recorder?.push(row);
}

export function jsFromWall(): (wall: number) => number {
  const offset = performance.now() - Date.now();
  return (wall) => wall + offset;
}

export const benchHandles: { cardPress?: (id: string) => void } = {};

export function useBenchHandle(name: "cardPress", fn: (id: string) => void): void {
  useEffect(() => {
    if (!DIAGNOSTICS) return;
    benchHandles[name] = fn;
    return () => {
      if (benchHandles[name] === fn) delete benchHandles[name];
    };
  }, [name, fn]);
}
