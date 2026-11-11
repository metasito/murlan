// Whether the fans' gloss is drawn as one picture or by the backs, held outside React so a settle renders the fans' gloss alone.
//
// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".

import type { SharedValue } from "react-native-reanimated";
import type { GlossLight } from "./cardGloss.ts";
import { isRested, restLight } from "./restEnds.ts";
import { resumeLamp, type Lamp } from "./lampRig.ts";

export interface GlossTracks {
  /** The light where the lamp rests, written at each settle: a back whose gloss the fan draws reads its foil glint there. */
  rest: SharedValue<GlossLight>;
  /** The felt's `EndsProps.side`: while it shows an end of a rested lamp, the rig may stop stepping it (`endsCarry`). */
  ends: SharedValue<number>;
  /** The lamp as it is now, which the rig may have stopped stepping: valid until the next call. */
  now(): Lamp;
  /** `now().t`, without carrying the rest of the lamp on. */
  clock(): number;
  /** The rig stops stepping the lamp from this instant; its clock runs on for `now` while the page shows. */
  hold(): void;
  held(): boolean;
  /** Carries the rig's own lamp on to now if it was held, and leaves it to the rig's steps again. */
  resume(s: Lamp): void;
  /** The page shows or is hidden: a hidden page steps no rig, so a held clock stops with it. */
  shown(visible: boolean): void;
  /** The lamp as it was when it last settled or a track last ran out, a copy: the fans bake anew from it when it changes. */
  get(): Lamp;
  subscribe(listener: () => void): () => void;
  /** True while the lamp glides, flares, is kicked or dims: the backs are then drawn live, as the mockup's `gloss()`, and the fans' gloss rests. */
  live(): boolean;
  /** The lamp is rested or is not (`isRested`), told when that changes. */
  update(rested: boolean): void;
  rebake(): void;
}

export function createGlossTracks(lamp: SharedValue<Lamp>, rest: SharedValue<GlossLight>, ends: SharedValue<number>, reduced: SharedValue<boolean>, resting: Lamp): GlossTracks {
  let taken = resting;
  let live = !isRested(resting);
  let heldAt = NaN;
  let hiddenAt = NaN;
  const carried = structuredClone(resting);
  const listeners = new Set<() => void>();
  const heldFor = () => {
    if (Number.isNaN(heldAt)) return 0;
    const until = Number.isNaN(hiddenAt) ? performance.now() : hiddenAt;
    return Math.max(0, until - heldAt) / 1000;
  };
  const now = () => {
    const s = lamp.get();
    if (Number.isNaN(heldAt)) return s;
    Object.assign(carried, s);
    carried.holds = { ...s.holds };
    carried.drawn = { ...s.drawn };
    resumeLamp(carried, heldFor(), reduced.get());
    return carried;
  };
  const tell = () => {
    taken = structuredClone(now());
    for (const listener of listeners) listener();
  };
  return {
    rest,
    ends,
    now,
    clock: () => lamp.get().t + heldFor(),
    hold: () => {
      heldAt = performance.now();
    },
    held: () => !Number.isNaN(heldAt),
    resume: (s) => {
      if (Number.isNaN(heldAt)) return;
      resumeLamp(s, heldFor(), reduced.get());
      heldAt = NaN;
    },
    shown: (visible) => {
      const at = performance.now();
      if (!visible) {
        if (Number.isNaN(hiddenAt)) hiddenAt = at;
        return;
      }
      if (!Number.isNaN(heldAt) && !Number.isNaN(hiddenAt)) heldAt += at - hiddenAt;
      hiddenAt = NaN;
    },
    get: () => taken,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    live: () => live,
    update: (rested) => {
      live = !rested;
      tell();
      if (rested) rest.value = restLight(taken);
    },
    rebake: tell,
  };
}
