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
  off(event: "connect" | "disconnect", listener: () => void): unknown;
};

const edgesOf = new WeakMap<LinkSocket, LinkEdges>();

function edgesFor(socket: LinkSocket): LinkEdges {
  let edges = edgesOf.get(socket);
  if (!edges) {
    edges = observeLink(NO_LINK, socket.connected, Date.now());
    edgesOf.set(socket, edges);
  }
  return edges;
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
        const observe = () => {
          edgesOf.set(socket, observeLink(edgesFor(socket), socket.connected, Date.now()));
          onChange();
        };
        observe();
        socket.on("connect", observe);
        socket.on("disconnect", observe);
        return () => {
          socket.off("connect", observe);
          socket.off("disconnect", observe);
        };
      },
      [socket]
    ),
    () => (socket ? edgesFor(socket) : NO_LINK),
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
