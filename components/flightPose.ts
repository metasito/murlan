import { Motion } from "../lib/tokens.ts";

export interface CardFrom { x: number; y: number; rot: number; scale: number }
export interface CardSlot { x: number; y: number; rot: number }
export interface Pose { x: number; y: number; rot: number; scale: number }

const EASE_POWER = 3;
const LIFT = 24;
const POP = 0.1;
const MOCKUP_CARD_W = 65.97;
const SLOT_ROT = 1.2;

function timing(catchUp: boolean, native: boolean): { card: number; stagger: number } {
  "worklet";
  if (catchUp) return { card: Motion.throw.catchUpCard, stagger: Motion.throw.catchUpStagger };
  return native ? Motion.nativeThrow : { card: Motion.throw.card, stagger: Motion.throw.stagger };
}

export function flightEndMs(n: number, catchUp: boolean, native = false): number {
  "worklet";
  const { card, stagger } = timing(catchUp, native);
  return card + (n - 1) * stagger;
}

export function flightPose(elapsedMs: number, i: number, n: number, from: CardFrom, to: CardSlot, catchUp: boolean, native = false): Pose {
  "worklet";
  const { card, stagger } = timing(catchUp, native);
  const k = Math.min(1, Math.max(0, (elapsedMs - i * stagger) / card));
  const e = 1 - Math.pow(1 - k, EASE_POWER);
  const arc = Math.sin(Math.PI * e);
  return {
    x: from.x + (to.x - from.x) * e,
    y: from.y + (to.y - from.y) * e - LIFT * arc,
    rot: from.rot + (to.rot - from.rot) * e,
    scale: from.scale + (1 - from.scale) * e + POP * arc,
  };
}

export function contactMs(n: number, from: CardFrom[], to: CardSlot[], catchUp: boolean, native = false): number {
  "worklet";
  const end = flightEndMs(n, catchUp, native);
  for (let t = 0; t < end; t++) {
    let touching = true;
    for (let i = 0; i < n && touching; i++) {
      const p = flightPose(t, i, n, from[i], to[i], catchUp, native);
      touching = Math.hypot(p.x - to[i].x, p.y - to[i].y) <= 1 && Math.abs(p.scale - 1) <= 0.01;
    }
    if (touching) return t;
  }
  return end;
}

/** `roomW` bounds the cards as drawn: the outer two are turned `SLOT_ROT` a step, which takes their corners past their slots. */
export function pileSlots(n: number, cardW: number, roomW: number, cardH: number): CardSlot[] {
  "worklet";
  const wanted = (n <= 2 ? 34 : n <= 4 ? 28 : 24) * (cardW / MOCKUP_CARD_W);
  const turn = (((n - 1) / 2) * SLOT_ROT * Math.PI) / 180;
  const drawnW = cardW * Math.cos(turn) + cardH * Math.sin(turn);
  const gap = n > 1 ? Math.min(wanted, (roomW - drawnW) / (n - 1)) : 0;
  const out: CardSlot[] = [];
  for (let i = 0; i < n; i++) {
    const c = i - (n - 1) / 2;
    out.push({ x: c * gap, y: 0, rot: c * SLOT_ROT });
  }
  return out;
}
