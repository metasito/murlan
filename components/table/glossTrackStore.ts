// The track every opponent's back reads, held outside React so a rebake renders the backs' gloss alone.
//
// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".

import { glossLive, type LampSnap } from "./glossTrack.ts";

/** A snapshot of the lamp and the `performance.now()` at which it was taken; `fanTrack.ts` bakes the track from it. */
export interface Published {
  snap: LampSnap;
  epoch: number;
}

export interface GlossTracks {
  get(): Published;
  subscribe(listener: () => void): () => void;
  /** Takes `snap` as of now. */
  publish(snap: LampSnap): void;
  /** True while the lamp glides, is kicked or dims: the backs are then drawn live, as the mockup's `gloss()`, and the tracks rest. */
  live(): boolean;
  setLive(live: boolean): void;
  /** The delay, in milliseconds, that starts an animation of `track` where the track is now. */
  delayOf(of: Published): number;
}

export function createGlossTracks(initial: LampSnap, now: () => number): GlossTracks {
  let track: Published = { snap: initial, epoch: now() };
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
      track = { snap, epoch: now() };
      for (const listener of listeners) listener();
    },
  };
}
