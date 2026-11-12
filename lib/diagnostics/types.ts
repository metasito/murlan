import type { LampSide } from "./lampLegibility";

export interface DiagRows {
  scenario: { name: string; phase: "start" | "end"; error?: string | null };
  run: { phase: "start" | "end"; names: string[] };
  build: { dev: boolean; scriptURL: string | null };
  arm: { name: "on" | "off"; phase: "start" | "end" };
  latency: { outputMs: number | null; ioMs: number | null; inputMs: number | null };
  trigger: { name: string };
  dropped: { name: string };
  refused: { host: string };
  crash: { message: string; stack?: string; componentStack?: string };
  resume: { done: string[]; next: string | null };
  capture: { phase: "start" | "stop"; error: string };
  play: { id: string; at: number; bus: string; dropped: boolean; lead: number };
  haptic: { kind: string; at: number };
  music: { track: string | null; at: number };
  engine: { state: string; audioMs: number; plays: number };
  soakPause: { resumedAt: number };
  frame: { dt: number };
  jsLag: { dt: number };
  jsTicks: { n: number };
  pulseCost: { ms: number; cold: boolean };
  footprint: { mb: number };
  sys: { battery: number; charging: boolean; thermal: number; lowPower: boolean; maxFps: number; cpuMs: number; gpuMb: number };
  window: { i: number };
  nativeDropped: { n: number };
  captureStopped: { error: string };
  onset: { db: number; source: "app" | "mic" };
  level: { db: number };
  shake: { g: number };
  ring: { name: string; x: number; y: number };
  seatState: { id: string; of: number; hold: number };
  lampLegibility: { side: LampSide; ratio: number };
  throw: Record<never, never>;
  half: { name: "frozen" | "swaying" | "on" | "off"; pair: number };
  notice: { kind: string; shape: string; phase: "enter" | "exit" | "still" | "unmounted"; ms: number; dt: number; src?: "gallery" };
  blink: { kind: string; period: number };
  dot: { kind: string; opacity: number };
  gallery: { kinds: number; fixtures: number };
  shown: { kind: string; fixture: number; reduced: boolean };
  orientation: { rn: { w: number; h: number }; native: Record<string, unknown> | null; error?: string };
  gate: { name: "deal" | "exchangeReady" | "exchangeDone" };
  /** Draws of the felt (`felt`) and of its end B (`end`) over a window at rest, and the frames the rig stepped, `rested` of them at rest. */
  atRest: { id: string; ms: number; felt: number; end: number; frames: number; rested: number };
  /** The same over a window of bots playing, `plays` cards thrown. */
  inPlay: { ms: number; plays: number; felt: number; end: number; frames: number; rested: number };
  /** A screenshot for the runner to take; the state stays until it says so, `acked` false when it never did. */
  shot: { id: string };
  shotAcked: { id: string; acked: boolean };
}

export type DiagRow = { [K in keyof DiagRows]: { k: K; t: number } & DiagRows[K] }[keyof DiagRows];
