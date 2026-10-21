import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  useSyncExternalStore,
  ReactNode,
} from "react";
import { router } from "expo-router";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "@/lib/query-client";
import { markStale, queryKey, stale, useApi, type Answer, type ApiKey, type ListRead, type Row } from "@/lib/queries";
import { useAuth } from "@/context/AuthContext";
import {
  connectSocket,
  disconnectSocket,
  peekSocket,
  subscribeToSockets,
  type Socket,
} from "@/lib/socket";
import { requireUpdate } from "@/lib/updateRequired";
import { CLIENT_OUTDATED } from "@/shared/protocol";
import { reportSocketClose } from "@/lib/errorReporting";
import { useNotification } from "@/context/NotificationContext";
import { SessionReplacedNotice } from "@/components/SessionReplacedNotice";
import { t, type ServerPayload } from "@/lib/i18n";
import { Reading } from "@/lib/theme";
import { reconnectDelayMs } from "@/lib/reconnectDelay";
import { sendInvite, undelivered } from "@/lib/sendIntent";
import type { FriendRequestAccepted, FriendRequestIncoming, GameInviteDto } from "@/shared/http";
import type { Socket as UntypedSocket } from "socket.io-client";

/**
 * Seats a row the server sent with its announcement into the list a fetch
 * would have filled, so the badge and the friends list move on the frame the
 * banner does rather than a round trip later.
 *
 * The invalidation each caller keeps behind this is the reconciler: the pushed
 * row is the fast path, the fetch is the truth. The row is optional at every
 * call site — a server that predates it, or a row created by a path that emits
 * nothing — and without one the fetch does all of the work, as it always did.
 */
function seatRow<P extends ListRead>(qc: QueryClient, key: ApiKey<P>, row: Row<P> | undefined) {
  if (!row) return;
  qc.setQueryData<Row<P>[]>(key, (rows = []) =>
    rows.some((r) => r.id === row.id) ? rows : [...rows, row]
  );
}

/**
 * The server closed this socket because the same account connected somewhere
 * else. Terminal by design: reconnecting would evict that other session in
 * turn, and the two would trade the account forever.
 */
const SESSION_REPLACED = "SESSION_REPLACED";

interface PendingInvite {
  from: string;
  roomCode: string;
}

interface Presence {
  onlineIds: ReadonlySet<string>;
  /** Asks the server who is online now: `friend:get_online_list`. */
  refresh: () => void;
}

interface Invites {
  invites: PendingInvite[];
  /** The invite that just arrived, which the online hub prefills and asks about; never a move. */
  prompt: PendingInvite | null;
  /**
   * The room the player has asked to be put into, set by tapping Join on an
   * invite or by opening app/join/[code].tsx (a join link, a tapped invite
   * push), and consumed by the online group, which is the only place
   * `joinRoom` exists.
   *
   * Distinct from `prompt`, which only says one arrived: an invite that
   * merely turns up must never move anyone, and this is what separates "look
   * now" from "take me there".
   */
  accepted: string | null;
  accept: (roomCode: string) => void;
  dismiss: (roomCode: string) => void;
  hide: (roomCode: string) => void;
  clearPrompt: () => void;
  /** Retires `roomCode`'s acceptance only: one accepted since then is still waiting for its join. */
  clearAccepted: (roomCode: string) => void;
  /** `friend:invite` with its ack; false on a timeout or a refusal, and the player has been told either way. */
  send: (friendUserId: string, roomCode: string) => Promise<boolean>;
}

const askWhoIsOnline = (socket: Socket) => socket.emit("friend:get_online_list");

const NO_HIDDEN_INVITES: ReadonlySet<string> = new Set();
// One empty list, not `= []`: a fresh default every render would wake every invites reader.
const NO_INVITE_ROWS: GameInviteDto[] = [];
const NO_PROVIDER = Symbol("no SocketProvider");

// Three contexts over one provider, so a friend coming online wakes only the
// presence readers, and the account-switch reset below stays in one place.
const ConnectionContext = createContext<Socket | null | typeof NO_PROVIDER>(NO_PROVIDER);
const PresenceContext = createContext<Presence | null>(null);
const InvitesContext = createContext<Invites | null>(null);

export function useSocketConnection(): Socket | null {
  const socket = useContext(ConnectionContext);
  if (socket === NO_PROVIDER) throw new Error("useSocketConnection must be used within SocketProvider");
  return socket;
}

export function usePresence(): Presence {
  const ctx = useContext(PresenceContext);
  if (!ctx) throw new Error("usePresence must be used within SocketProvider");
  return ctx;
}

export function useInvites(): Invites {
  const ctx = useContext(InvitesContext);
  if (!ctx) throw new Error("useInvites must be used within SocketProvider");
  return ctx;
}

export function SocketProvider({ children, random }: { children: ReactNode; random?: () => number }) {
  const { user, forgetSession } = useAuth();
  // The id, not the object: this is what the socket effect below keys on, and
  // `user` gets a new identity on every refetch of the same account.
  const userId = user?.id;
  const qc = useQueryClient();
  const { showNotification, notifyError, notifyServerError } = useNotification();
  // `lib/socket`'s map is already the one socket per user, so a copy here would
  // be a second answer to the same question for the effect below to keep in step.
  const socket = useSyncExternalStore(
    subscribeToSockets,
    () => peekSocket(userId),
    () => null
  );
  const [onlineIds, setOnlineIds] = useState<ReadonlySet<string>>(() => new Set());
  const [pendingInvite, setPendingInvite] = useState<PendingInvite | null>(null);
  // The row is the invite; the socket event and the push are both only "look
  // now". Holding this in component state instead was why an invite that
  // arrived while the socket was down could not be seen anywhere afterwards.
  const { data: inviteRows = NO_INVITE_ROWS } = useApi(queryKey("friends/invites"), {
    enabled: !!userId,
    refetchOnWindowFocus: true,
  });
  // The cached lists are one account's and their keys do not say whose. Cleared
  // here, after this commit disabled every observer: a clear that lands first lets
  // an earlier render's pending effect refetch them with the dead session.
  const signedInRef = useRef(userId);
  useEffect(() => {
    if (signedInRef.current && !userId) qc.clear();
    signedInRef.current = userId;
  }, [userId, qc]);
  // Keyed by account rather than reset on sign-out: a render after the clear
  // above re-subscribes the invites query and puts it back in the emptied cache.
  // One set per account, because a callback can settle after its account signed
  // out (a decline's rejection) and must land in that account's set alone.
  const [hidden, setHidden] = useState<ReadonlyMap<string | undefined, ReadonlySet<string>>>(
    () => new Map()
  );
  const hiddenInvites = hidden.get(userId) ?? NO_HIDDEN_INVITES;
  const updateHiddenInvites = useCallback(
    (update: (codes: Set<string>) => void) =>
      setHidden((prev) => {
        const codes = new Set(prev.get(userId) ?? NO_HIDDEN_INVITES);
        update(codes);
        return new Map(prev).set(userId, codes);
      }),
    [userId]
  );
  const gameInvites = useMemo<PendingInvite[]>(
    () =>
      inviteRows
        .filter((row) => !hiddenInvites.has(row.roomCode))
        .map((row) => ({ from: row.fromUsername, roomCode: row.roomCode })),
    [inviteRows, hiddenInvites]
  );
  const [sessionReplaced, setSessionReplaced] = useState<ServerPayload | null>(null);
  const socketRef = useRef<Socket | null>(null);
  // The socket's auth is a ticket-minting callback now, so the connected user
  // id has to be tracked here to tear the singleton down on logout.
  const connectedUserIdRef = useRef<string | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Consecutive failed handshake attempts, for the backoff below. Reset on
  // every successful connect.
  const retryAttemptRef = useRef(0);

  const clearInvite = useCallback(() => setPendingInvite(null), []);

  // Filtered on read rather than spliced from the cache: an accepted invite's row
  // stays on the server until seating, so any refetch before then would restore it.
  const hideGameInvite = useCallback(
    (roomCode: string) => updateHiddenInvites((codes) => codes.add(roomCode)),
    [updateHiddenInvites]
  );
  const unhideGameInvite = useCallback(
    (roomCode: string) => updateHiddenInvites((codes) => codes.delete(roomCode)),
    [updateHiddenInvites]
  );
  /**
   * Turning an invite down deletes it rather than hiding it. A dismissal that
   * only cleared the screen would come back on the next reconnect, and would
   * leave the host waiting for someone who has already said no.
   */
  const dismissGameInvite = useCallback(
    (roomCode: string) => {
      hideGameInvite(roomCode);
      void api("DELETE friends/invites/:roomCode", { params: { roomCode } })
        .catch(() => unhideGameInvite(roomCode))
        .finally(() => markStale(qc, [queryKey("friends/invites")]));
    },
    [qc, hideGameInvite, unhideGameInvite]
  );

  const [acceptedInvite, setAcceptedInvite] = useState<string | null>(null);
  // Answering an invite answers it for both: leaving `pendingInvite` up would
  // reopen the code prompt over the join it just started, for the same room.
  // Hidden, not deleted: the row is the invitee's seat hold until they are seated
  // (`server/game/seatAllocation.ts`), and the server stops offering it then.
  const acceptInvite = useCallback(
    (roomCode: string) => {
      hideGameInvite(roomCode);
      setPendingInvite((pending) => (pending?.roomCode === roomCode ? null : pending));
      setAcceptedInvite(roomCode);
    },
    [hideGameInvite]
  );
  const clearAcceptedInvite = useCallback(
    (roomCode: string) => setAcceptedInvite((accepted) => (accepted === roomCode ? null : accepted)),
    []
  );

  /**
   * Claims the account back on this device. The only way out of the replaced
   * state: nothing reconnects on its own once the server has said the session
   * moved.
   */
  const reconnectHere = useCallback(() => {
    setSessionReplaced(null);
    const socket = socketRef.current;
    if (!socket) return;
    socket.io.reconnection(true);
    socket.connect();
  }, []);

  // Everything below describes one account's connection, so the account
  // changing — signing out, or signing in as someone else — retires all of it in
  // the same render. Left to the effect, a new session would read the previous
  // one's answers for a frame.
  const [shownUserId, setShownUserId] = useState(userId);
  if (userId !== shownUserId) {
    setShownUserId(userId);
    setOnlineIds(new Set());
    setSessionReplaced(null);
    setPendingInvite(null);
    setAcceptedInvite(null);
  }

  useEffect(() => {
    if (!userId) {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      if (socketRef.current) {
        const uid = connectedUserIdRef.current;
        if (uid) disconnectSocket(uid);
        socketRef.current = null;
        connectedUserIdRef.current = null;
      }
      return;
    }

    // The ticket endpoint reported the session is dead (401): no amount of
    // retrying will ever succeed. Stop hammering it, log out locally and
    // send the user back to auth instead of looping forever.
    // Bound to this run alone: after an account switch the previous socket can
    // still be minting, and its 401 says nothing about the session now signed in.
    let bound = true;
    const onAuthFailure = () => {
      if (!bound) return;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      retryAttemptRef.current = 0;
      socket.io.reconnection(false);
      socket.disconnect();
      void forgetSession().finally(() => router.replace("/auth"));
    };
    const socket = connectSocket(userId, { onAuthFailure });
    socketRef.current = socket;
    connectedUserIdRef.current = userId;

    const onConnect = () => {
      setSessionReplaced(null);
      retryAttemptRef.current = 0;
      askWhoIsOnline(socket);
      // Anything that happened while the socket was down was pushed to nobody:
      // `emitToUser` drops the event when the recipient has no socket, and no
      // second attempt is ever made. The rows are the truth, so connecting is
      // where we ask again — otherwise a friend request sent to someone
      // offline is invisible to them, and neither side can then act on it.
      markStale(qc, stale.onReconnect);
    };

    const onDisconnect = (reason: UntypedSocket.DisconnectReason) => reportSocketClose(reason);

    // A handshake rejected by server middleware (expired or already-used
    // ticket) destroys the socket's subscriptions, so socket.io will not retry
    // it and `socket.active` is false. This loop owns that case alone, backing
    // off exponentially (capped, jittered) while the auth callback mints a fresh ticket
    // per attempt. While `active` is true the library's own reconnection is
    // still running and owns the retry.
    const onConnectError = (err: Error) => {
      // Retrying cannot help: this bundle is below the server's floor.
      if (err.message === CLIENT_OUTDATED) return requireUpdate();
      if (socket.active) return;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      const attempt = retryAttemptRef.current++;
      const delay = reconnectDelayMs(attempt, random);
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        if (!socket.connected) socket.connect();
      }, delay);
    };

    const onOnlineList = ({ onlineIds: ids }: { onlineIds: string[] }) => {
      setOnlineIds(new Set(ids));
    };

    const onFriendStatus = ({
      userId: friendId,
      online,
      lastSeen,
    }: {
      userId: string;
      online: boolean;
      lastSeen?: string;
    }) => {
      setOnlineIds((prev) => {
        const next = new Set(prev);
        if (online) {
          next.add(friendId);
        } else {
          next.delete(friendId);
        }
        return next;
      });
      // The row reads its time from this cache, which otherwise keeps whatever
      // GET friends returned while the friend was still online — their
      // previous disconnect, not the one just announced.
      if (lastSeen) {
        qc.setQueryData<Answer<"friends">>(
          queryKey("friends"),
          (friends) => friends?.map((f) => (f.id === friendId ? { ...f, lastSeen } : f))
        );
      }
    };

    const onRequestIncoming = ({ from, request }: FriendRequestIncoming) => {
      seatRow(qc, queryKey("friends/requests"), request);
      markStale(qc, [queryKey("friends/requests")]);
      showNotification({
        type: "friend_request",
        title: t("notifications.friendRequestTitle"),
        message: t("notifications.friendRequestBody", { name: from }),
        onPress: () => router.push("/(online)/friends"),
      });
    };

    const onRequestAccepted = ({ by, friend }: FriendRequestAccepted) => {
      seatRow(qc, queryKey("friends"), friend);
      markStale(qc, stale.friendAccepted);
      askWhoIsOnline(socket);
      showNotification({
        type: "friend_accepted",
        title: t("notifications.friendAcceptedTitle"),
        message: t("notifications.friendAcceptedBody", { name: by }),
        onPress: () => router.push("/(online)/friends"),
      });
    };

    const onInvite = ({ from, roomCode }: { from: string; roomCode: string }) => {
      setPendingInvite({ from, roomCode });
      unhideGameInvite(roomCode);
      markStale(qc, [queryKey("friends/invites")]);
      showNotification({
        type: "game_invite",
        title: t("notifications.gameInviteTitle", { name: from }),
        message: t("notifications.gameInviteBody", { code: roomCode }),
        duration: Reading.invite,
        onPress: () => {
          router.push("/(online)");
        },
      });
    };

    // An invite this account holds has stopped being good — its room started,
    // or emptied and closed. The list is cached with `staleTime: Infinity`, so
    // without this the banner outlives the room it points at until the next
    // reconnect. The code names which room died, and nothing more: which
    // invites survive is the server's answer to give, so the list is re-asked.
    const onInviteRetired = ({ roomCode }: { roomCode: string }) => {
      setPendingInvite((prev) => (prev?.roomCode === roomCode ? null : prev));
      markStale(qc, [queryKey("friends/invites")]);
    };

    // The invite itself is still good either way, so the list is simply re-asked
    // — it filters on the seat count already. No banner on the way back: a
    // stranger leaving a lobby is not an invitation.
    const onRoomJoinable = ({ roomCode, joinable }: { roomCode: string; joinable: boolean }) => {
      if (!joinable) setPendingInvite((prev) => (prev?.roomCode === roomCode ? null : prev));
      markStale(qc, [queryKey("friends/invites")]);
    };

    // Keep the whole payload: the server emits a stable `code` (plus `params`)
    // alongside a plain-text `message`, so the client can render it in the
    // player's own language. `translateServerPayload` falls back to the
    // server's plain text if the code is unknown to this build.
    const onFriendError = (payload: ServerPayload) => {
      notifyServerError(payload);
    };
    const onSocketError = (payload: ServerPayload) => {
      if (payload.code === SESSION_REPLACED) {
        if (retryTimerRef.current) {
          clearTimeout(retryTimerRef.current);
          retryTimerRef.current = null;
        }
        retryAttemptRef.current = 0;
        socket.io.reconnection(false);
        socket.disconnect();
        setSessionReplaced(payload);
        return;
      }
      notifyServerError(payload);
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.on("friend:online_list", onOnlineList);
    socket.on("friend:status", onFriendStatus);
    socket.on("friend:request_incoming", onRequestIncoming);
    socket.on("friend:request_accepted", onRequestAccepted);
    socket.on("friend:invite", onInvite);
    socket.on("friend:invite_retired", onInviteRetired);
    socket.on("friend:room_joinable", onRoomJoinable);
    socket.on("friend:error", onFriendError);
    socket.on("socket:error", onSocketError);

    if (socket.connected) askWhoIsOnline(socket);

    return () => {
      bound = false;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.off("friend:online_list", onOnlineList);
      socket.off("friend:status", onFriendStatus);
      socket.off("friend:request_incoming", onRequestIncoming);
      socket.off("friend:request_accepted", onRequestAccepted);
      socket.off("friend:invite", onInvite);
      socket.off("friend:invite_retired", onInviteRetired);
      socket.off("friend:room_joinable", onRoomJoinable);
      socket.off("friend:error", onFriendError);
      socket.off("socket:error", onSocketError);
    };
  }, [userId, forgetSession, qc, showNotification, notifyServerError, unhideGameInvite, random]);

  const refresh = useCallback(() => {
    if (socket) askWhoIsOnline(socket);
  }, [socket]);
  const presence = useMemo(() => ({ onlineIds, refresh }), [onlineIds, refresh]);

  // A refusal arrives as `friend:error` too, and `onFriendError` tells it: only silence is told here.
  const send = useCallback(
    async (friendUserId: string, roomCode: string) => {
      const outcome = await sendInvite(socket, { friendUserId, roomCode });
      if (undelivered(outcome)) {
        notifyError(t("room.requestNotDelivered"), { duration: Reading.notice });
      }
      return outcome.ok;
    },
    [socket, notifyError]
  );

  const invites = useMemo(
    () => ({
      invites: gameInvites,
      prompt: pendingInvite,
      accepted: acceptedInvite,
      accept: acceptInvite,
      dismiss: dismissGameInvite,
      hide: hideGameInvite,
      clearPrompt: clearInvite,
      clearAccepted: clearAcceptedInvite,
      send,
    }),
    [
      gameInvites,
      pendingInvite,
      acceptedInvite,
      acceptInvite,
      dismissGameInvite,
      hideGameInvite,
      clearInvite,
      clearAcceptedInvite,
      send,
    ]
  );

  return (
    <ConnectionContext.Provider value={socket}>
      <PresenceContext.Provider value={presence}>
        <InvitesContext.Provider value={invites}>
          {children}
          {sessionReplaced ? (
            <SessionReplacedNotice payload={sessionReplaced} onReconnect={reconnectHere} />
          ) : null}
        </InvitesContext.Provider>
      </PresenceContext.Provider>
    </ConnectionContext.Provider>
  );
}
