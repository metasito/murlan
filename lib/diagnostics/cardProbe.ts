import { useEffect, useRef, type RefObject } from "react";
import type { View } from "react-native";
import type { DiagRow } from "./types";

const ON = process.env.EXPO_PUBLIC_DIAGNOSTICS === "1";
const PROBE_MS = 300;

type Recorder = { push(row: DiagRow): void; postTo(host: string): void };
let recorder: Recorder | null = null;

function connect(): Recorder | null {
  if (!ON) return null;
  if (!recorder) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- a static import would ship the recorder
    recorder = require("./recorder").recorder as Recorder;
    const host = /^\w+:\/\/([^:/]+)/.exec(process.env.EXPO_PUBLIC_DOMAIN ?? "")?.[1] ?? "127.0.0.1";
    recorder.postTo(host);
  }
  return recorder;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

export function round(v: unknown): unknown {
  if (typeof v === "number") return Number.isFinite(v) ? r1(v) : String(v);
  if (Array.isArray(v)) return v.map(round);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)]));
  return v;
}

type Frame = { win: number[]; rel: number[] } | null;

function frame(view: View | null): Promise<Frame> {
  if (!view) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 1000);
    view.measureInWindow((x, y, w, h) => {
      view.measure((rx, ry, rw, rh, px, py) => {
        clearTimeout(timer);
        resolve({ win: [x, y, w, h].map(r1), rel: [rx, ry, rw, rh, px, py].map(r1) });
      });
    });
  });
}

const claimed = new Set<string>();

export function useCardProbe(kind: "pile" | "hand", views: Record<string, RefObject<View | null>>, meta: () => Record<string, unknown>): void {
  const latest = useRef({ views, meta });
  useEffect(() => {
    latest.current = { views, meta };
  });
  useEffect(() => {
    const rec = connect();
    if (!rec) return;
    if (kind === "hand") {
      if (claimed.has(kind)) return;
      claimed.add(kind);
    }
    let last = "";
    let busy = false;
    let stopped = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      const { views: now, meta: read } = latest.current;
      const frames = Object.fromEntries(await Promise.all(Object.entries(now).map(async ([name, ref]) => [name, await frame(ref.current)] as const)));
      busy = false;
      if (stopped) return;
      const row = { kind, ...(round(read()) as Record<string, unknown>), frames };
      const text = JSON.stringify(row);
      if (text === last) return;
      last = text;
      rec.push({ k: "cardProbe", t: performance.now(), ...row });
    };
    void tick();
    const id = setInterval(tick, PROBE_MS);
    return () => {
      stopped = true;
      clearInterval(id);
      if (kind === "hand") claimed.delete(kind);
    };
  }, [kind]);
}
