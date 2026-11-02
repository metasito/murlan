import type { StateOrder, WireGameState } from "./protocol.ts";

/** The order a state takes its place in, or null for a server that sends none. */
export function orderOf(state: WireGameState): StateOrder | null {
  const { roomId, epoch, seq } = state;
  return typeof roomId === "string" && typeof epoch === "number" && typeof seq === "number" ? { roomId, epoch, seq } : null;
}

/** Whether a state arriving now goes over `last`, the last one taken for its table (`StateOrder`). */
export function supersedes(next: StateOrder | null, last: StateOrder | null): boolean {
  if (!next || !last || next.roomId !== last.roomId) return true;
  return next.epoch > last.epoch || (next.epoch === last.epoch && next.seq > last.seq);
}
