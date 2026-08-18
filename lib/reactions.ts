// The emoji reactions currently rising from the felt.
//
// A module store rather than a field on OnlineGameContext, for the same reason
// lib/cosmetics.ts is one: an incoming reaction writes twice — once to show it,
// once to drop it — and a field on the context value turns each of those into a
// re-render of the whole table, cards included. The server allows eight
// reactions per ten seconds per seat and broadcasts every one to every client.
// FloatingReactions subscribes here on its own, so the writes reach it and
// nothing else.
//
// No react-native import, so tests load it directly.
import { useSyncExternalStore } from "react";

export interface TableReaction {
  id: string;
  emoji: string;
  username: string;
  fromSeat: number;
}

/** How long a reaction stays mounted. It has faded out well before this. */
export const REACTION_TTL_MS = 2500;

/** A burst rolls off the oldest rather than piling up on the felt. */
const MAX_ON_SCREEN = 10;

let current: TableReaction[] = [];
const listeners = new Set<() => void>();
const timers = new Set<ReturnType<typeof setTimeout>>();
let nextId = 0;

function emit(): void {
  listeners.forEach((fn) => fn());
}

/** Shows a reaction and schedules its own removal. */
export function pushReaction(reaction: Omit<TableReaction, "id">): void {
  const id = `r${nextId++}`;
  current = [...current.slice(1 - MAX_ON_SCREEN), { ...reaction, id }];
  emit();
  const timer = setTimeout(() => {
    timers.delete(timer);
    current = current.filter((r) => r.id !== id);
    emit();
  }, REACTION_TTL_MS);
  timers.add(timer);
}

/**
 * Empties the felt and cancels every pending removal with it. The store
 * outlives the provider that feeds it, so leaving a table has to say so —
 * otherwise the next one opens with the last one's emoji still on it.
 */
export function clearReactions(): void {
  timers.forEach(clearTimeout);
  timers.clear();
  if (current.length === 0) return;
  current = [];
  emit();
}

/** The useSyncExternalStore pair, exported so the store is testable without a renderer. */
export function subscribeToReactions(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The current list. A new array only when it changed, so subscribers settle. */
export function readReactions(): TableReaction[] {
  return current;
}

/** The reactions on screen right now. */
export function useTableReactions(): TableReaction[] {
  return useSyncExternalStore(subscribeToReactions, readReactions, readReactions);
}
