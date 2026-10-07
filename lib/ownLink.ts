import { Reconnect } from "./tokens.ts";

export type OwnLink = "up" | "dropped" | "reconnecting" | "lost" | "back";

/** `downAt` is set while the viewer's socket is down after having been up; `upAt` when it last came back. */
export type LinkEdges = { readonly everUp: boolean; readonly downAt: number | null; readonly upAt: number | null };

export const NO_LINK: LinkEdges = { everUp: false, downAt: null, upAt: null };

export function observeLink(edges: LinkEdges, connected: boolean, now: number): LinkEdges {
  if (connected) {
    if (edges.downAt !== null) return { everUp: true, downAt: null, upAt: now };
    return edges.everUp ? edges : { ...edges, everUp: true };
  }
  if (!edges.everUp || edges.downAt !== null) return edges;
  return { everUp: true, downAt: now, upAt: null };
}

export function ownLinkAt(edges: LinkEdges, now: number): OwnLink {
  if (edges.downAt !== null) {
    const down = now - edges.downAt;
    return down >= Reconnect.giveUp ? "lost" : down >= Reconnect.pillAfter ? "reconnecting" : "dropped";
  }
  return edges.upAt !== null && now - edges.upAt < Reconnect.back ? "back" : "up";
}

export function nextLinkChangeIn(edges: LinkEdges, now: number): number | null {
  if (edges.downAt !== null) {
    const down = now - edges.downAt;
    if (down < Reconnect.pillAfter) return Reconnect.pillAfter - down;
    return down < Reconnect.giveUp ? Reconnect.giveUp - down : null;
  }
  if (edges.upAt === null) return null;
  const since = now - edges.upAt;
  return since < Reconnect.back ? Reconnect.back - since : null;
}
