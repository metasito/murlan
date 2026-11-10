// The track every opponent's back reads, held outside React so a rebake renders the backs' gloss alone.
//
// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".

import { bakeGlossTrack, glossLive, type GlossTrack, type LampSnap } from "./glossTrack.ts";

export interface GlossTracks {
  get(): GlossTrack;
  subscribe(listener: () => void): () => void;
  /** Bakes a track from `snap`, as of now. */
  publish(snap: LampSnap): void;
  /** True while the lamp glides, is kicked or dims: the backs are then drawn live, as the mockup's `gloss()`, and the tracks rest. */
  live(): boolean;
  setLive(live: boolean): void;
  /** The delay, in milliseconds, that starts an animation of `track` where the track is now. */
  delayOf(track: GlossTrack): number;
}

export function createGlossTracks(initial: LampSnap, now: () => number): GlossTracks {
  let track = bakeGlossTrack(initial, now());
  let live = glossLive(initial);
  const listeners = new Set<() => void>();
  return {
    get: () => track,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    live: () => live,
    setLive: (next) => {
      if (next === live) return;
      live = next;
      for (const listener of listeners) listener();
    },
    delayOf: (of) => -(now() - of.epoch),
    publish: (snap) => {
      track = bakeGlossTrack(snap, now());
      for (const listener of listeners) listener();
    },
  };
}
