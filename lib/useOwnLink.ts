import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
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

/** The viewer's own link as the table shows it: the socket's edges, and the time since the last one. */
export function useOwnLink(socket: LinkSocket | null): OwnLink {
  const edges = useSyncExternalStore(
    useCallback(
      (onChange: () => void) => {
        if (!socket) return () => {};
        const observe = () => {
          edgesOf.set(socket, observeLink(edgesOf.get(socket) ?? NO_LINK, socket.connected, Date.now()));
          onChange();
        };
        edgesOf.set(socket, NO_LINK);
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
    () => (socket && edgesOf.get(socket)) || NO_LINK,
    () => NO_LINK
  );
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const wait = nextLinkChangeIn(edges, Date.now());
    if (wait === null) return;
    const id = setTimeout(() => setNow(Date.now()), wait);
    return () => clearTimeout(id);
  }, [edges, now]);

  return ownLinkAt(edges, Math.max(now, edges.downAt ?? edges.upAt ?? 0));
}

/** Whether `state` brings cards the viewer missed: from the drop through the first state after it (`observeCatchUp`). */
export function useCatchUp(link: OwnLink, state: unknown): boolean {
  const [held, setHeld] = useState(NO_CATCH_UP);
  const next = observeCatchUp(held, link, state);
  if (next !== held) setHeld(next);
  return catchingUp(next, state);
}
