// The track every opponent's back reads, held outside React so a rebake renders the backs' gloss alone.
//
// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".

import { bakeGlossTrack, type GlossTrack, type LampSnap } from "./glossTrack.ts";

export interface GlossTracks {
  get(): GlossTrack;
  subscribe(listener: () => void): () => void;
  /** Bakes a track from `snap`, as of now. */
  publish(snap: LampSnap): void;
  /** The delay, in milliseconds, that starts an animation of `track` where the track is now. */
  delayOf(track: GlossTrack): number;
}

export function createGlossTracks(initial: LampSnap, now: () => number): GlossTracks {
  let track = bakeGlossTrack(initial, now());
  const listeners = new Set<() => void>();
  return {
    get: () => track,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    delayOf: (of) => -(now() - of.epoch),
    publish: (snap) => {
      track = bakeGlossTrack(snap, now());
      for (const listener of listeners) listener();
    },
  };
}
