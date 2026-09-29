import { Motion } from "../lib/tokens.ts";

export interface CardFrom { x: number; y: number; rot: number; scale: number }
export interface CardSlot { x: number; y: number; rot: number }
export interface Pose { x: number; y: number; rot: number; scale: number }

const EASE_POWER = 3;
const LIFT = 24;
const POP = 0.1;
const MOCKUP_CARD_W = 65.97;
const SLOT_ROT = 1.2;

function timing(catchUp: boolean): { card: number; stagger: number } {
  "worklet";
  return catchUp
    ? { card: Motion.throw.catchUpCard, stagger: Motion.throw.catchUpStagger }
    : { card: Motion.throw.card, stagger: Motion.throw.stagger };
}

export function flightEndMs(n: number, catchUp: boolean): number {
  "worklet";
  const { card, stagger } = timing(catchUp);
  return card + (n - 1) * stagger;
}

export function flightPose(elapsedMs: number, i: number, n: number, from: CardFrom, to: CardSlot, catchUp: boolean): Pose {
  "worklet";
  const { card, stagger } = timing(catchUp);
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

export function contactMs(n: number, from: CardFrom[], to: CardSlot[], catchUp: boolean): number {
  "worklet";
  const end = flightEndMs(n, catchUp);
  for (let t = 0; t < end; t++) {
    let touching = true;
    for (let i = 0; i < n && touching; i++) {
      const p = flightPose(t, i, n, from[i], to[i], catchUp);
      touching = Math.hypot(p.x - to[i].x, p.y - to[i].y) <= 1 && Math.abs(p.scale - 1) <= 0.01;
    }
    if (touching) return t;
  }
  return end;
}

export function pileSlots(n: number, cardW: number, roomW: number): CardSlot[] {
  "worklet";
  const wanted = (n <= 2 ? 34 : n <= 4 ? 28 : 24) * (cardW / MOCKUP_CARD_W);
  const gap = n > 1 ? Math.min(wanted, (roomW - cardW) / (n - 1)) : 0;
  const out: CardSlot[] = [];
  for (let i = 0; i < n; i++) {
    const c = i - (n - 1) / 2;
    out.push({ x: c * gap, y: 0, rot: c * SLOT_ROT });
  }
  return out;
}
