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

/** The states that hold the table: the grey, the freeze, the stopped clock. */
export const linkHeld = (link: OwnLink) => link === "dropped" || link === "reconnecting" || link === "lost";

export const holdGrey = (link: OwnLink) => (linkHeld(link) ? Reconnect.grey : 0);

export type LinkPill = "lost" | "back" | "reconnecting" | "reconnected";

/** `connected` is the socket's own flag, so a socket never up still reads as reconnecting; `otherBack` is another seat's return. */
export function linkPill(link: OwnLink, connected: boolean, otherBack: boolean): LinkPill | null {
  if (link === "lost" || link === "back" || link === "reconnecting") return link;
  if (!connected && link === "up") return "reconnecting";
  return connected && otherBack ? "reconnected" : null;
}

/** `seen` is the state the table held at the drop; `by` is the first one after it, which brought the missed cards. */
export type CatchUp = { readonly waiting: boolean; readonly seen: unknown; readonly by: unknown };

export const NO_CATCH_UP: CatchUp = { waiting: false, seen: undefined, by: undefined };

export function observeCatchUp(c: CatchUp, link: OwnLink, state: unknown): CatchUp {
  if (linkHeld(link)) return c.waiting ? c : { waiting: true, seen: state, by: undefined };
  return c.waiting && state !== c.seen ? { waiting: false, seen: state, by: state } : c;
}

export const catchingUp = (c: CatchUp, state: unknown) => c.waiting || c.by === state;

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
