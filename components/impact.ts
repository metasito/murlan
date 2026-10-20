// The impact a landing earns: its tier, the shake, the beaten pile's flinch, the lamp's flare and the
// landed group's wobble.
//
// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".

import type { Combination } from "@/lib/game/gameEngine";
import { Spacing, Trauma } from "../lib/tokens.ts";

/** A card leaving a fan starts at the mockup's `.4` of its size on the felt (index.html `play()`). */
export const FAN_CARD_SCALE = 0.4;

// ─── Flight and impact timing ─────────────────────────────────────────────────
//
// A played combination flies from its seat to the pile before it arrives. Sound,
// haptics and the bomb's screen shake are the *impact*, so they belong at the
// moment the card lands — firing them at launch puts the bang a third of a
// second before the thing that caused it.
//
// PileLayer (components/table/pile.tsx) owns the animation; these are the numbers both it
// and the table's feedback read, so the two cannot drift apart.

/** The mockup's `landWobble` (#1242), off the Motion scale: its sine rates are set against this span. */
export const LAND_WOBBLE_MS = 400;

/**
 * Its scale and rotation in degrees, `k` of the way through. Both are at rest at 0 and at 1, so
 * reduced motion needs only `k` held at 0.
 */
export function landWobble(k: number): { scale: number; rotate: number } {
  "worklet";
  const t = (k * LAND_WOBBLE_MS) / 1000;
  return {
    scale: 1 + 0.035 * Math.sin(50.8 * t) * Math.pow(1 - k, 3),
    rotate: 0.6 * Math.sin(40.8 * t) * Math.pow(1 - k, 2),
  };
}

// ─── Screen shake ──────────────────────────────────────────────────────────────
//
// The table's trauma at each rung of the landing escalation #101 settled — the
// one place #764 (the beaten pile's flinch) and #765 (the lamp flare) key
// their own magnitudes off, by the same five tiers, rather than inventing a
// second classification that could disagree with this one.

export type ImpactTier = "ordinary" | "straight" | "bomb" | "roundWon" | "matchWon";

const TRAUMA_BY_TIER: Record<ImpactTier, number> = {
  ordinary: 0,
  straight: 0,
  bomb: Trauma.bomb,
  roundWon: Trauma.roundWon,
  matchWon: Trauma.matchWon,
};

/** The tier a played combination's own shape lands at, on its own. */
export function comboImpactTier(comboType: Combination["type"]): ImpactTier {
  if (comboType === "bomb") return "bomb";
  if (comboType === "straight" || comboType === "royal_straight") return "straight";
  return "ordinary";
}

/**
 * The tier one landing falls at, once whatever it closed is folded in.
 *
 * A round closes when `GameState.roundOver` turns true — `processPlay`
 * (lib/game/gameEngine.ts) sets it the moment a hand empties, its own comment
 * calling that "the hand is decided", which `docs/GAME-RULES.md` names the
 * round. A match closing is a *further* fact about that same landing,
 * carried by the match verdict (`lib/game/matchState.ts` `MatchVerdict.over`,
 * `lib/game/matchFlow.ts` `applyRoundToMatch`, the online
 * `game:round_over`/`matchOver` payload): the play that empties a seat's hand is
 * also the play that happens to close the match, never a second, later
 * event. `GameState.trickWinner` is not read here — `docs/GAME-RULES.md` §9
 * calls that a *trick*, and it closes many times a round.
 *
 * One landing fires one tier: a play that is itself a bomb and also closes
 * the round or the match is still only as loud as its loudest rung —
 * `TRAUMA_BY_TIER` is what decides which that is, so this can't disagree
 * with the table by naming a tier lower than the play already earned.
 */
export function landingTier(input: {
  comboType: Combination["type"];
  roundOver: boolean;
  matchOver: boolean;
  /** The viewer won what this landing closes: the match when `matchOver`, else the round. A pending outcome is not a win. */
  viewerWon: boolean;
}): ImpactTier {
  const playTier = comboImpactTier(input.comboType);
  if (!input.roundOver || !input.viewerWon) return playTier;
  const closureTier: ImpactTier = input.matchOver ? "matchWon" : "roundWon";
  return TRAUMA_BY_TIER[playTier] >= TRAUMA_BY_TIER[closureTier] ? playTier : closureTier;
}

/** The tier's peak trauma, or 0 outright when the player asked for less motion or no shake. */
export function traumaFor(tier: ImpactTier, reduceMotion: boolean, shakeOff: boolean): number {
  "worklet";
  return reduceMotion || shakeOff ? 0 : TRAUMA_BY_TIER[tier];
}

/**
 * How far the beaten combination (`components/table/trick.ts`, `beatenPlay`) is knocked as the new
 * one lands on it, scaled by the table like `shakeOffset` — colocated with
 * `TRAUMA_BY_TIER` so #764 and #765 read the same five tiers. `straight`
 * is not silent, unlike trauma: #101's own table keeps it the smallest
 * non-zero step on purpose, reserving the escalation's headroom for the
 * bomb. Widen `Spacing.xxs` here — not `TRAUMA_BY_TIER` — if that reads too
 * subtle on a device.
 */
const FLINCH_BY_TIER: Record<ImpactTier, number> = {
  ordinary: 0,
  straight: Spacing.xxs,
  bomb: Spacing.slim,
  roundWon: Spacing.slim,
  matchWon: Spacing.slim,
};

/** The tier's own flinch, or 0 outright when the player asked for less motion — the caller scales the answer by the table the way `shakeOffset` scales trauma. */
export function flinchFor(tier: ImpactTier, reduceMotion: boolean): number {
  "worklet";
  return reduceMotion ? 0 : FLINCH_BY_TIER[tier];
}

/**
 * The shake's own amplitude `elapsedMs` into a decay window of `decayMs` —
 * trauma squared, not trauma (see `Trauma`, lib/tokens.ts, for why squaring
 * wins over the raw value): the tier's own trauma decays linearly to 0 across
 * `decayMs`, and what the table reads back is that decaying value squared.
 * `decayMs` is a parameter rather than a constant read in here: the caller
 * resolves it through `motionMs("shake", reduceMotion)` (`Motion.duration.shake`,
 * lib/tokens.ts), so this file never holds its own copy of a timing value for
 * `motionMs`/`Motion.reduced` to drift from. `decayMs` 0 (the reduced-motion
 * answer) is rest, not a division by zero.
 */
export function shakeMagnitude(trauma: number, elapsedMs: number, decayMs: number): number {
  "worklet";
  if (decayMs <= 0) return 0;
  const t = Math.min(Math.max(elapsedMs, 0), decayMs) / decayMs;
  const remaining = trauma * (1 - t);
  return remaining * remaining;
}

/** Full cycles the shake wiggles through across its own decay window. */
const SHAKE_CYCLES = 3;
/**
 * Peak displacement at trauma 1, before the tier's own trauma scales it down
 * — `Spacing.md`/`Spacing.snug` (lib/tokens.ts), not a pixel literal: a
 * shake is a distance on the same scale as a padding, the way `hitSlop` is.
 */
const SHAKE_AMPLITUDE_X = Spacing.md;
const SHAKE_AMPLITUDE_Y = Spacing.snug;

/**
 * The bomb's own peak, layered on top of the amplitude above rather than
 * replacing it: `kick` (`components/useTableFeedback.ts`) is gated to
 * `bomb`/`royal_straight` alone, so a round or match closed by an
 * ordinary combination has no kick to lean on, and one shared amplitude
 * moves every tier by the same ratio once trauma is squared — this is
 * reserved for the one tier that needs the headroom.
 */
const BOMB_SHAKE_AMPLITUDE_X = Spacing.xxl;
const BOMB_SHAKE_AMPLITUDE_Y = Spacing.lg;
const BOMB_SHAKE_ROTATE_DEG = 1.2;

interface ShakeAmplitude {
  x: number;
  y: number;
  /** Degrees at trauma 1. */
  rotate: number;
}

/** Which peak a tier's shake reads — every tier but the bomb shares the default above. */
export function shakeAmplitudeFor(tier: ImpactTier): ShakeAmplitude {
  "worklet";
  if (tier === "bomb") {
    return { x: BOMB_SHAKE_AMPLITUDE_X, y: BOMB_SHAKE_AMPLITUDE_Y, rotate: BOMB_SHAKE_ROTATE_DEG };
  }
  return { x: SHAKE_AMPLITUDE_X, y: SHAKE_AMPLITUDE_Y, rotate: 0 };
}

/**
 * The table's own displacement `elapsedMs` into a shake of `decayMs` —
 * `shakeMagnitude` riding a decaying wiggle rather than a single
 * push-and-recover, so the hit reads as a shake rather than a shove. `cos`
 * rather than `sin`: the jolt peaks at the moment of impact (`elapsedMs` 0)
 * instead of building up to it. `scale` is the table's own — `kick`
 * (components/useTableFeedback.ts) multiplies its jolts by the same value, so
 * a shake is a fraction of the table rather than a fixed pixel count that
 * reads huge on a phone and vanishes on a tablet. `amplitude` defaults to the
 * shared peak above; the caller passes `shakeAmplitudeFor(tier)` to let one
 * tier read a different one.
 */
export function shakeOffset(
  trauma: number,
  elapsedMs: number,
  decayMs: number,
  scale: number,
  amplitude: ShakeAmplitude = { x: SHAKE_AMPLITUDE_X, y: SHAKE_AMPLITUDE_Y, rotate: 0 }
): { x: number; y: number; rotate: number } {
  "worklet";
  const magnitude = shakeMagnitude(trauma, elapsedMs, decayMs);
  const phase = decayMs <= 0 ? 0 : (elapsedMs / decayMs) * Math.PI * 2 * SHAKE_CYCLES;
  const wiggle = decayMs <= 0 ? 0 : Math.cos(phase);
  return {
    x: magnitude * wiggle * amplitude.x * scale,
    y: magnitude * wiggle * amplitude.y * scale,
    rotate: magnitude * Math.sin(phase) * amplitude.rotate,
  };
}

// ─── Lamp flare and lift (#765) ──────────────────────────────────────────────
//
// The lamp's own reaction to a landing, at the graduated tiers #101 settled
// (the "C — Cinema" row of #772's grammar). Reads `ImpactTier` — the same
// tier #763 squares into a shake — rather than a second table: a round is
// the expected ending and hands over to its own banner, so it lifts instead
// of flaring; the bomb and the match both throw light, because both are the
// surprise the shake already ranks above a round closing.

/** What the lamp's own flare does at a tier's landing, if anything. */
export type FlareKind = "none" | "brief" | "settle";

export function flareKindFor(tier: ImpactTier): FlareKind {
  "worklet";
  if (tier === "bomb") return "brief";
  if (tier === "matchWon") return "settle";
  return "none";
}
