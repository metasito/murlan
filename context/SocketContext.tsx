import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  ReactNode,
} from "react";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import { useAuth } from "@/context/AuthContext";
import { connectSocket, disconnectSocket, setSocketAuthFailureHandler } from "@/lib/socket";
import { useNotification } from "@/context/NotificationContext";
import { SessionReplacedNotice } from "@/components/SessionReplacedNotice";
import { t, translateServerPayload, type ServerPayload } from "@/lib/i18n";
import { Reading } from "@/lib/theme";
import type { Socket } from "socket.io-client";

const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 30_000;

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

/** `GET /api/friends/invites` — the invites still open for this account. */
interface InviteRow {
  id: string;
  roomCode: string;
  fromUsername: string;
  createdAt: string;
}

interface SocketContextValue {
  socket: Socket | null;
  connected: boolean;
  onlineIds: Set<string>;
  pendingInvite: PendingInvite | null;
  clearInvite: () => void;
  gameInvites: PendingInvite[];
  dismissGameInvite: (roomCode: string) => void;
  /**
   * The room the player has asked to be put into, set by tapping Join on an
   * invite and consumed by the online group, which is the only place
   * `joinRoom` exists.
   *
   * Distinct from `pendingInvite`, which only says one arrived: an invite that
   * merely turns up must never move anyone, and this is what separates "look
   * now" from "take me there".
   */
  acceptedInvite: string | null;
  acceptInvite: (roomCode: string) => void;
  clearAcceptedInvite: () => void;
}

/**
 * What a reconnect re-reads, because the events that would have changed it are
 * dropped rather than queued when the socket is down. Presence is deliberately
 * absent: who was online while you were away is not a fact worth catching up
 * on, and `friend:get_online_list` answers it fresh anyway.
 */
const RECONCILED_ON_CONNECT = [
  ["/api/friends"],
  ["/api/friends/requests"],
  ["/api/friends/sent"],
  ["/api/friends/invites"],
] as const;

const SocketContext = createContext<SocketContextValue | null>(null);

export function useSocket() {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error("useSocket must be used within SocketProvider");
  return ctx;
}

export function SocketProvider({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  // The id, not the object: this is what the socket effect below keys on, and
  // `user` gets a new identity on every refetch of the same account.
  const userId = user?.id;
  const qc = useQueryClient();
  const { showNotification } = useNotification();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());
  const [pendingInvite, setPendingInvite] = useState<PendingInvite | null>(null);
  // The row is the invite; the socket event and the push are both only "look
  // now". Holding this in component state instead was why an invite that
  // arrived while the socket was down could not be seen anywhere afterwards.
  const { data: inviteRows = [] } = useQuery<InviteRow[]>({
    queryKey: ["/api/friends/invites"],
    enabled: !!userId,
    refetchOnWindowFocus: true,
  });
  const gameInvites = useMemo<PendingInvite[]>(
    () => inviteRows.map((row) => ({ from: row.fromUsername, roomCode: row.roomCode })),
    [inviteRows]
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

  const [acceptedInvite, setAcceptedInvite] = useState<string | null>(null);
  const acceptInvite = useCallback((roomCode: string) => setAcceptedInvite(roomCode), []);
  const clearAcceptedInvite = useCallback(() => setAcceptedInvite(null), []);

  /**
   * Turning an invite down deletes it rather than hiding it. A dismissal that
   * only cleared the screen would come back on the next reconnect, and would
   * leave the host waiting for someone who has already said no.
   */
  const dismissGameInvite = useCallback(
    (roomCode: string) => {
      qc.setQueryData<InviteRow[]>(["/api/friends/invites"], (prev) =>
        (prev ?? []).filter((row) => row.roomCode !== roomCode)
      );
      void apiRequest("DELETE", `/api/friends/invites/${roomCode}`)
        .catch(() => {})
        .finally(() => qc.invalidateQueries({ queryKey: ["/api/friends/invites"] }));
    },
    [qc]
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

  useEffect(() => {
    if (!userId) {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      setSocketAuthFailureHandler(null);
      if (socketRef.current) {
        const uid = connectedUserIdRef.current;
        if (uid) disconnectSocket(uid);
        socketRef.current = null;
        connectedUserIdRef.current = null;
        setSocket(null);
      }
      setConnected(false);
      setOnlineIds(new Set());
      setSessionReplaced(null);
      return;
    }

    const socket = connectSocket(userId);
    socketRef.current = socket;
    connectedUserIdRef.current = userId;
    setSocket(socket);

    // The ticket endpoint reported the session is dead (401): no amount of
    // retrying will ever succeed. Stop hammering it, log out locally and
    // send the user back to auth instead of looping forever.
    const onAuthFailure = () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      retryAttemptRef.current = 0;
      socket.io.reconnection(false);
      socket.disconnect();
      // The cached lists are one account's — friends, requests, invitations —
      // and the query keys do not name whose. The deliberate logout in
      // SettingsModal clears them; this path is a logout too, and the next
      // account to sign in on this device would otherwise be served them.
      qc.clear();
      void logout().finally(() => router.replace("/auth"));
    };
    setSocketAuthFailureHandler(onAuthFailure);

    const onConnect = () => {
      setConnected(true);
      setSessionReplaced(null);
      retryAttemptRef.current = 0;
      socket.emit("friend:get_online_list");
      // Anything that happened while the socket was down was pushed to nobody:
      // `emitToUser` drops the event when the recipient has no socket, and no
      // second attempt is ever made. The rows are the truth, so connecting is
      // where we ask again — otherwise a friend request sent to someone
      // offline is invisible to them, and neither side can then act on it.
      for (const queryKey of RECONCILED_ON_CONNECT) qc.invalidateQueries({ queryKey });
    };

    const onDisconnect = () => {
      setConnected(false);
    };

    // A handshake rejected by server middleware (expired or already-used
    // ticket) destroys the socket's subscriptions, so socket.io will not retry
    // it and `socket.active` is false. This loop owns that case alone, backing
    // off exponentially (capped) while the auth callback mints a fresh ticket
    // per attempt. While `active` is true the library's own reconnection is
    // still running and owns the retry.
    const onConnectError = () => {
      setConnected(false);
      if (socket.active) return;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      const attempt = retryAttemptRef.current++;
      const delay = Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
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
      // /api/friends returned while the friend was still online — their
      // previous disconnect, not the one just announced.
      if (lastSeen) {
        qc.setQueryData<{ id: string; lastSeen: string | null }[]>(
          ["/api/friends"],
          (friends) => friends?.map((f) => (f.id === friendId ? { ...f, lastSeen } : f))
        );
      }
    };

    const onRequestIncoming = ({ from }: { from: string }) => {
      qc.invalidateQueries({ queryKey: ["/api/friends/requests"] });
      showNotification({
        type: "friend_request",
        title: t("notifications.friendRequestTitle"),
        message: t("notifications.friendRequestBody", { name: from }),
        onPress: () => router.push("/(online)/friends"),
      });
    };

    const onRequestAccepted = ({ by }: { by: string }) => {
      qc.invalidateQueries({ queryKey: ["/api/friends"] });
      qc.invalidateQueries({ queryKey: ["/api/friends/requests"] });
      qc.invalidateQueries({ queryKey: ["/api/friends/sent"] });
      socket.emit("friend:get_online_list");
      showNotification({
        type: "friend_accepted",
        title: t("notifications.friendAcceptedTitle"),
        message: t("notifications.friendAcceptedBody", { name: by }),
        onPress: () => router.push("/(online)/friends"),
      });
    };

    const onInvite = ({ from, roomCode }: { from: string; roomCode: string }) => {
      setPendingInvite({ from, roomCode });
      qc.invalidateQueries({ queryKey: ["/api/friends/invites"] });
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

    // Keep the whole payload: the server emits a stable `code` (plus `params`)
    // alongside a plain-text `message`, so the client can render it in the
    // player's own language. `translateServerPayload` falls back to the
    // server's plain text if the code is unknown to this build.
    const onFriendError = (payload: ServerPayload) => {
      showNotification({
        type: "game_error",
        title: t("common.error"),
        message: translateServerPayload(payload),
        duration: Reading.notice,
      });
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
      showNotification({
        type: "game_error",
        title: t("common.error"),
        message: translateServerPayload(payload),
        duration: Reading.notice,
      });
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.on("friend:online_list", onOnlineList);
    socket.on("friend:status", onFriendStatus);
    socket.on("friend:request_incoming", onRequestIncoming);
    socket.on("friend:request_accepted", onRequestAccepted);
    socket.on("friend:invite", onInvite);
    socket.on("friend:error", onFriendError);
    socket.on("socket:error", onSocketError);

    if (socket.connected) {
      setConnected(true);
      socket.emit("friend:get_online_list");
    }

    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      setSocketAuthFailureHandler(null);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.off("friend:online_list", onOnlineList);
      socket.off("friend:status", onFriendStatus);
      socket.off("friend:request_incoming", onRequestIncoming);
      socket.off("friend:request_accepted", onRequestAccepted);
      socket.off("friend:invite", onInvite);
      socket.off("friend:error", onFriendError);
      socket.off("socket:error", onSocketError);
    };
  }, [userId, logout, qc, showNotification]);

  const contextValue = useMemo(
    () => ({
      socket,
      connected,
      onlineIds,
      pendingInvite,
      clearInvite,
      gameInvites,
      dismissGameInvite,
      acceptedInvite,
      acceptInvite,
      clearAcceptedInvite,
    }),
    [
      socket,
      connected,
      onlineIds,
      pendingInvite,
      gameInvites,
      clearInvite,
      dismissGameInvite,
      acceptedInvite,
      acceptInvite,
      clearAcceptedInvite,
    ]
  );

  return (
    <SocketContext.Provider value={contextValue}>
      {children}
      {sessionReplaced ? (
        <SessionReplacedNotice payload={sessionReplaced} onReconnect={reconnectHere} />
      ) : null}
    </SocketContext.Provider>
  );
}
