import type { Bus } from "./audioEngine";
import type { PulseStrength, TapHaptic } from "./hapticsEngine";
import type { SoundId } from "./soundAssets";

type Plain = "roundWon" | "roundStart" | "select" | "deselect" | "reject" | "give" | "pass" | "deal" | "exchange" | "turn" | "clockRunningOut";

export type Moment =
  | { kind: "landing"; cards: number; bomb: boolean; mine: boolean }
  | { kind: "mancheOver"; outcome: "won" | "lost" | "neutral" }
  | { kind: "partitaOver"; won: boolean }
  | { [K in Plain]: { kind: K } }[Plain];
export type MomentKind = Moment["kind"];
export type LandingKind = "play" | "combo" | "bomb";

export interface PulseStep {
  strength: PulseStrength;
  offsetMs: number;
}

export interface Haptic {
  tap: TapHaptic;
  atMs: number;
}

export interface Cue {
  sound: SoundId | null;
  bus: Bus;
  haptics: Haptic[];
}

export interface MomentSpec<K extends MomentKind> {
  priority: number;
  input?: true;
  cue(m: Extract<Moment, { kind: K }>): Cue;
}

export interface Played {
  at: number;
  priority: number;
  id: SoundId;
}

export const PILE_UP_WINDOW_MS = 120;
const PARTITA_LEAD_MS = 300;

export const LANDING_PULSES: Record<LandingKind, readonly PulseStep[]> = {
  play: [{ strength: "light", offsetMs: 0 }],
  combo: [{ strength: "medium", offsetMs: 0 }],
  bomb: [
    { strength: "rigid", offsetMs: 0 },
    { strength: "heavy", offsetMs: 256 },
    { strength: "light", offsetMs: 416 },
  ],
};

export const isCombo = (cards: number): boolean => cards > 1;

export function landingKind(m: { cards: number; bomb: boolean }): LandingKind {
  return m.bomb ? "bomb" : isCombo(m.cards) ? "combo" : "play";
}

export function landingPulsesFor(m: { cards: number; bomb: boolean; mine: boolean }): readonly PulseStep[] {
  return m.bomb || m.mine ? LANDING_PULSES[landingKind(m)] : [];
}

const tap = (t: TapHaptic): Haptic[] => [{ tap: t, atMs: 0 }];
const sfx = (sound: SoundId, haptics: Haptic[] = []): Cue => ({ sound, bus: "sfx", haptics });

export const MOMENTS = {
  partitaOver: {
    priority: 100,
    cue: (m) => ({
      sound: m.won ? "partitaWon" : "partitaLost",
      bus: "sting",
      haptics: [{ tap: "medium", atMs: -PARTITA_LEAD_MS }, { tap: m.won ? "success" : "warn", atMs: 0 }],
    }),
  },
  mancheOver: {
    priority: 95,
    cue: (m) =>
      m.outcome === "won"
        ? { sound: "mancheWon", bus: "sting", haptics: tap("success") }
        : m.outcome === "lost"
          ? { sound: "mancheLost", bus: "sting", haptics: tap("warn") }
          : { sound: "mancheNeutral", bus: "sting", haptics: [] },
  },
  roundWon: { priority: 80, cue: () => sfx("round_win") },
  landing: {
    priority: 70,
    cue: (m) =>
      m.bomb
        ? { sound: "bomb", bus: "sting", haptics: [] }
        : sfx(isCombo(m.cards) ? "combo" : "play"),
  },
  pass: { priority: 60, cue: () => sfx("pass") },
  exchange: { priority: 55, cue: () => sfx("exchange") },
  deal: { priority: 50, cue: () => sfx("deal") },
  roundStart: { priority: 45, cue: () => sfx("round_start") },
  turn: { priority: 40, cue: () => sfx("turn", tap("light")) },
  clockRunningOut: { priority: 35, cue: () => sfx("clockRunningOut") },
  give: { priority: 30, input: true, cue: () => sfx("play", tap("medium")) },
  reject: { priority: 25, input: true, cue: () => sfx("reject", tap("rigid")) },
  select: { priority: 20, input: true, cue: () => sfx("select", tap("selection")) },
  deselect: { priority: 20, input: true, cue: () => sfx("deselect", tap("selection")) },
} satisfies { [K in MomentKind]: MomentSpec<K> };

type AnySpec = { priority: number; input?: true; cue(m: Moment): Cue };
const specOf = (m: Moment) => MOMENTS[m.kind] as unknown as AnySpec;

export function cueFor(m: Moment): Cue {
  return specOf(m).cue(m);
}

export function mix(
  batch: Moment[],
  at: number,
  played: Played[],
  now = at
): { sound: { id: SoundId; bus: Bus } | null; haptics: Haptic[]; withdrawn: SoundId[]; played: Played[] } {
  const ranked = batch.map((m) => ({ spec: specOf(m), cue: cueFor(m) })).sort((a, b) => b.spec.priority - a.spec.priority);
  const recent = played.filter((p) => p.at >= at - PILE_UP_WINDOW_MS);
  const near = recent.filter((p) => Math.abs(p.at - at) < PILE_UP_WINDOW_MS);
  const top = ranked.find((r) => r.cue.sound !== null);
  // A started sound cannot be taken back, so it holds its window; one still waiting yields to a higher one.
  const masked = !!top && !top.spec.input && near.some((p) => p.priority > top.spec.priority || p.at <= now);
  const sound = top?.cue.sound && !masked ? { id: top.cue.sound, bus: top.cue.bus } : null;
  const withdrawn = sound && top ? near.filter((p) => p.priority < top.spec.priority && p.at > now) : [];
  const pulsed = batch.some((m) => m.kind === "landing" && landingPulsesFor(m).length > 0);
  const haptics = pulsed ? [] : (ranked.find((r) => r.cue.haptics.length > 0)?.cue.haptics ?? []);
  const kept = recent.filter((p) => !withdrawn.includes(p));
  return {
    sound,
    haptics,
    withdrawn: withdrawn.map((p) => p.id),
    played: sound && top && !top.spec.input ? [...kept, { at, priority: top.spec.priority, id: sound.id }] : kept,
  };
}
