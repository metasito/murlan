// The felt while the lamp glides (#1989, GL): the cloth is baked and still, and the light pool is a layer of its own that the
// compositor moves, so no frame of the glide shades the cloth. Near either end of the glide the cloth baked lit for that end
// carries the light, and the layer gives it over where the two pools lie together, so the felt never shows two.
//
// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".

import { SWAY, type Lamp } from "./lampRig.ts";

/** Design points the lamp may lie from its target and be there: the felt draws that target's baked cloth from here in. */
export const SETTLED_PT = 3;
/** Design points from an end of the glide by which the moving layer has taken the light from that end's baked cloth. */
const HANDOFF_PT = 60;

/** What a glide's frame draws over the unlit cloth: an end's baked cloth at an opacity, crossed at a lean. */
export interface GlideEnd {
  opacity: number;
  lean: number;
}

/** Each end over the unlit cloth, from then to, and the pool layer's weight over them. */
export interface GlideCloth {
  from: GlideEnd;
  to: GlideEnd;
  pool: number;
}

function handed(d: number): number {
  "worklet";
  const s = Math.min(1, Math.max(0, (d - SETTLED_PT) / (HANDOFF_PT - SETTLED_PT)));
  return s * s * (3 - 2 * s);
}

/** How a gliding lamp `s` shows in the cloth baked at either end of a target's sway: `opacity` 0 out of its reach, `lean` as `leanOf` would have it. */
function glideEnd(s: Pick<Lamp, "x" | "y" | "lx">, end: readonly [number, number] | null): { opacity: number; lean: number; away: number } {
  "worklet";
  if (!end) return { opacity: 0, lean: 0.5, away: 1 };
  const away = handed(Math.hypot(s.x - end[0], s.y - end[1]));
  return { opacity: 1 - away, lean: Math.min(1, Math.max(0, 0.5 + (s.lx - end[0]) / (2 * SWAY))), away };
}

/**
 * The cloth of a gliding lamp `s`, from the target `from` it rested at toward `to`, both pool centres in design points,
 * either null while that end has no baked cloth. The layer carries what neither end's cloth does.
 */
export function glideCloth(s: Pick<Lamp, "x" | "y" | "lx">, from: readonly [number, number] | null, to: readonly [number, number] | null): GlideCloth {
  "worklet";
  const a = glideEnd(s, from);
  const b = glideEnd(s, to);
  return { from: { opacity: a.opacity, lean: a.lean }, to: { opacity: b.opacity, lean: b.lean }, pool: a.away * b.away };
}
