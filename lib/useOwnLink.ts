import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  NO_CATCH_UP,
  NO_LINK,
  catchingUp,
  nextLinkChangeIn,
  observeCatchUp,
  observeLink,
  ownLinkAt,
  type LinkEdges,
  type OwnLink,
} from "./ownLink";

type LinkSocket = {
  readonly connected: boolean;
  on(event: "connect" | "disconnect", listener: () => void): unknown;
};

type Tracked = { edges: LinkEdges; readonly readers: Set<() => void> };

const tracked = new WeakMap<LinkSocket, Tracked>();

/**
 * Followed from first sight for the socket's whole life, readers or none: edges missed while
 * nobody read them would leave the next reader an outage that ended, or a way back long past.
 */
function trackedFor(socket: LinkSocket): Tracked {
  const known = tracked.get(socket);
  if (known) return known;
  const track: Tracked = { edges: observeLink(NO_LINK, socket.connected, Date.now()), readers: new Set() };
  const observe = () => {
    track.edges = observeLink(track.edges, socket.connected, Date.now());
    track.readers.forEach((read) => read());
  };
  socket.on("connect", observe);
  socket.on("disconnect", observe);
  tracked.set(socket, track);
  return track;
}

/**
 * The viewer's own link as the table shows it: the socket's edges, and the time since the last one.
 * `connected` is read off the same edges, so a socket never up reads as not connected.
 */
export function useOwnLink(socket: LinkSocket | null): { link: OwnLink; connected: boolean } {
  const edges = useSyncExternalStore(
    useCallback(
      (onChange: () => void) => {
        if (!socket) return () => {};
        const { readers } = trackedFor(socket);
        readers.add(onChange);
        return () => {
          readers.delete(onChange);
        };
      },
      [socket]
    ),
    () => (socket ? trackedFor(socket).edges : NO_LINK),
    () => NO_LINK
  );
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const wait = nextLinkChangeIn(edges, Date.now());
    if (wait === null) return;
    const id = setTimeout(() => setNow(Date.now()), wait);
    return () => clearTimeout(id);
  }, [edges, now]);

  const link = ownLinkAt(edges, Math.max(now, edges.downAt ?? edges.upAt ?? 0));
  const connected = edges.everUp && edges.downAt === null;
  return useMemo(() => ({ link, connected }), [link, connected]);
}

/** Whether `state` brings cards the viewer missed: from the drop through the first state after it (`observeCatchUp`). */
export function useCatchUp(link: OwnLink, state: unknown): boolean {
  const [held, setHeld] = useState(NO_CATCH_UP);
  const next = observeCatchUp(held, link, state);
  if (next !== held) setHeld(next);
  return catchingUp(next, state);
}
