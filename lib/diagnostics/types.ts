import type { LampSide } from "./lampLegibility";

export interface DiagRows {
  scenario: { name: string; phase: "start" | "end"; error?: string | null };
  build: { dev: boolean; scriptURL: string | null };
  arm: { name: "on" | "off"; phase: "start" | "end" };
  latency: { outputMs: number | null; ioMs: number | null; inputMs: number | null };
  trigger: { name: string };
  dropped: { name: string };
  play: { id: string; at: number; bus: string; dropped: boolean; lead: number };
  haptic: { kind: string; at: number };
  music: { track: string | null; at: number };
  engine: { state: string; audioMs: number; plays: number };
  frame: { dt: number };
  jsLag: { dt: number };
  jsTicks: { n: number };
  pulseCost: { ms: number; cold: boolean };
  footprint: { mb: number };
  onset: { db: number; source: "app" | "mic" };
  level: { db: number };
  shake: { g: number };
  ring: { name: string; x: number; y: number };
  seatState: { id: string; of: number; hold: number };
  lampLegibility: { side: LampSide; ratio: number };
  throw: Record<never, never>;
  half: { name: "frozen" | "swaying" | "on" | "off"; pair: number };
}

export type DiagRow = { [K in keyof DiagRows]: { k: K; t: number } & DiagRows[K] }[keyof DiagRows];
