// Whether the fans' gloss is drawn as one picture or by the backs, held outside React so a settle renders the fans' gloss alone.
//
// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".

import type { SharedValue } from "react-native-reanimated";
import type { GlossLight } from "./cardGloss.ts";
import { isRested, restLight } from "./restEnds.ts";
import type { Lamp } from "./lampRig.ts";

export interface GlossTracks {
  /** The rig's lamp, which the fans read where it rests when a track is baked and where its clock is when it is steered. */
  lamp: SharedValue<Lamp>;
  /** The light where the lamp rests, written at each settle: a back whose gloss the fan draws reads its foil glint there. */
  rest: SharedValue<GlossLight>;
  /** The lamp as it was when it last settled or a track last ran out, a copy: the fans bake anew from it when it changes. */
  get(): Lamp;
  subscribe(listener: () => void): () => void;
  /** True while the lamp glides, flares, is kicked or dims: the backs are then drawn live, as the mockup's `gloss()`, and the fans' gloss rests. */
  live(): boolean;
  /** The lamp is rested or is not (`isRested`), told when that changes. */
  update(rested: boolean): void;
  rebake(): void;
}

export function createGlossTracks(lamp: SharedValue<Lamp>, rest: SharedValue<GlossLight>, resting: Lamp): GlossTracks {
  let taken = resting;
  let live = !isRested(resting);
  const listeners = new Set<() => void>();
  const tell = () => {
    taken = structuredClone(lamp.get());
    for (const listener of listeners) listener();
  };
  return {
    lamp,
    rest,
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
