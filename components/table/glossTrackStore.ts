// The track every opponent's back reads, held outside React so a rebake renders the backs' gloss alone.
//
// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".

import type { SharedValue } from "react-native-reanimated";
import type { LampSnap } from "./glossTrack.ts";

/** A snapshot of the lamp and the `performance.now()` at which it was taken; `fanTrack.ts` bakes the track from it. */
export interface Published {
  snap: LampSnap;
  epoch: number;
}

export interface GlossTracks {
  get(): Published;
  subscribe(listener: () => void): () => void;
  live(): boolean;
  /** The snapshot the track was last baked from, which a back whose gloss the fan draws reads its foil glint at (`restLight`). */
  baked: SharedValue<LampSnap>;
  /** Takes `snap` as of now when there is one, and whether the lamp is moving (`glossLive`): the backs are drawn live, as the mockup's `gloss()`, while it is, and the tracks rest. */
  update(snap: LampSnap | null, live: boolean): void;
}

export function createGlossTracks(initial: LampSnap, baked: SharedValue<LampSnap>): GlossTracks {
  let track: Published = { snap: initial, epoch: performance.now() };
  let live = false;
  const listeners = new Set<() => void>();
  return {
    get: () => track,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    live: () => live,
    baked,
    update: (snap, moving) => {
      if (snap) {
        track = { snap, epoch: performance.now() };
        baked.value = snap;
      }
      live = moving;
      for (const listener of listeners) listener();
    },
  };
}
