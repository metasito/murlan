import { useEffect, useRef } from "react";
import { router, useSegments } from "expo-router";
import { useInvites } from "./SocketContext";
import { useOnlineConnection, useOnlineRoom } from "./onlineGameHooks";
import { NO_TABLE, navigationFor, onlineRouteOf, type OnlineFacts, type OnlineRoute } from "./onlineRouting";

/** Mounted once, inside `OnlineGameProvider`, in `app/(online)/_layout.tsx`: screens only render. */
export function useOnlineRouting(): void {
  const { room, hasGame, isSpectator, entrySource, joinRoom } = useOnlineRoom();
  const { connected, rejoinFailed, clearRejoinFailed } = useOnlineConnection();
  const { accepted: acceptedInvite, clearAccepted: clearAcceptedInvite } = useInvites();
  const here = onlineRouteOf(useSegments());

  const roomId = room?.roomId ?? null;
  // `left` is the place a navigation was sent from: `useSegments` still names it until the
  // router lands, and judging that stale place again would send the player off it twice.
  // What changes meanwhile is judged on landing, against the facts the navigation left with.
  const seen = useRef<{ facts: OnlineFacts; here: OnlineRoute; left: OnlineRoute | null }>({
    facts: NO_TABLE,
    here: "other",
    left: null,
  });

  useEffect(() => {
    const next: OnlineFacts = {
      roomId,
      hasGame,
      isSpectator: Boolean(isSpectator),
      rejoinFailed: Boolean(rejoinFailed),
    };
    const { facts: prev, here: was, left } = seen.current;
    if (was === here && sameFacts(prev, next)) return;
    if (left === here) return;

    const navigation = navigationFor(prev, next, here, entrySource);
    seen.current = { facts: next, here, left: navigation ? here : null };
    if (navigation?.kind === "push") router.push(navigation.to);
    else if (navigation?.kind === "replace") router.replace(navigation.to);
    if (next.rejoinFailed) clearRejoinFailed();
  }, [roomId, hasGame, isSpectator, rejoinFailed, here, entrySource, clearRejoinFailed]);

  // Held until the socket is up: `joinRoom` emits, and an emit on a socket that has not
  // connected is dropped without a word. Accepted stays set until the join's answer, which
  // is what a screen reads as "joining": a room it already holds changes no room fact.
  const joining = useRef<string | null>(null);
  useEffect(() => {
    if (!acceptedInvite || !connected || joining.current === acceptedInvite) return;
    const code = acceptedInvite;
    joining.current = code;
    void joinRoom(code).then(() => {
      if (joining.current === code) joining.current = null;
      clearAcceptedInvite(code);
    });
  }, [acceptedInvite, connected, clearAcceptedInvite, joinRoom]);
}

function sameFacts(a: OnlineFacts, b: OnlineFacts): boolean {
  return (
    a.roomId === b.roomId &&
    a.hasGame === b.hasGame &&
    a.isSpectator === b.isSpectator &&
    a.rejoinFailed === b.rejoinFailed
  );
}
