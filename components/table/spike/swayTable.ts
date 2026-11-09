export const SWAY_AMPLITUDE = 20;
export const HALF_SWINGS = 80;
export const SWAY_EASING = "cubic-bezier(0.445, 0.05, 0.55, 0.95)";

const omega = (t: number) => 0.84 * (1 + 0.14 * Math.sin(t * 0.11 + 1.3) + 0.06 * Math.sin(t * 0.37));

function build(): number[] {
  const stops = [0];
  let ph = 0;
  const dt = 0.001;
  for (let t = 0; stops.length <= HALF_SWINGS; t += dt) {
    const next = ph + omega(t) * dt;
    if (Math.floor(next / Math.PI) > Math.floor(ph / Math.PI)) stops.push(t + dt);
    ph = next;
  }
  return stops;
}

/** Start time of each half-swing, in seconds; the last entry is the loop length. */
export const STOPS = build();
export const LOOP_SECONDS = STOPS[HALF_SWINGS];

/** End-B opacity at table time `t`: each half-swing is the keyframe easing itself, so the CSS animation and the live rig are the same curve. */
export function opacityFrom(stops: number[], t: number): number {
  const loop = stops[stops.length - 1];
  const s = ((t % loop) + loop) % loop;
  let k = 0;
  while (k < stops.length - 2 && stops[k + 1] <= s) k++;
  const u = (s - stops[k]) / (stops[k + 1] - stops[k]);
  const [x1, y1, x2, y2] = [0.445, 0.05, 0.55, 0.95];
  const bez = (a: number, b: number, v: number) => 3 * (1 - v) ** 2 * v * a + 3 * (1 - v) * v * v * b + v ** 3;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (bez(x1, x2, mid) < u) lo = mid;
    else hi = mid;
  }
  const e = bez(y1, y2, (lo + hi) / 2);
  return k % 2 === 0 ? e : 1 - e;
}

export const opacityAt = (t: number) => opacityFrom(STOPS, t);

/** The lamp's x offset in points at table time `t`. */
export const lxAt = (t: number) => SWAY_AMPLITUDE * (2 * opacityAt(t) - 1);

export const lxOfOpacity = (o: number) => SWAY_AMPLITUDE * (2 * o - 1);

export function keyframes(): Record<string, { opacity: number; animationTimingFunction?: string }> {
  const out: Record<string, { opacity: number; animationTimingFunction?: string }> = {};
  for (let k = 0; k <= HALF_SWINGS; k++) {
    const pct = (100 * STOPS[k]) / LOOP_SECONDS;
    out[k === HALF_SWINGS ? "100%" : `${pct}%`] = { opacity: k % 2 === 0 ? 0 : 1, ...(k < HALF_SWINGS ? { animationTimingFunction: SWAY_EASING } : {}) };
  }
  return out;
}
