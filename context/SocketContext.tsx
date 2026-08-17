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
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { connectSocket, disconnectSocket, setSocketAuthFailureHandler } from "@/lib/socket";
import { useNotification } from "@/context/NotificationContext";
import { t, translateServerPayload, type ServerPayload } from "@/lib/i18n";
import type { Socket } from "socket.io-client";

const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 30_000;

interface PendingInvite {
  from: string;
  roomCode: string;
}

interface SocketContextValue {
  socket: Socket | null;
  connected: boolean;
  onlineIds: Set<string>;
  pendingInvite: PendingInvite | null;
  clearInvite: () => void;
  gameInvites: PendingInvite[];
  dismissGameInvite: (roomCode: string) => void;
}

const SocketContext = createContext<SocketContextValue>({
  socket: null,
  connected: false,
  onlineIds: new Set(),
  pendingInvite: null,
  clearInvite: () => {},
  gameInvites: [],
  dismissGameInvite: () => {},
});

export function useSocket() {
  return useContext(SocketContext);
}

export function SocketProvider({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const qc = useQueryClient();
  const { showNotification } = useNotification();
  const [connected, setConnected] = useState(false);
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());
  const [pendingInvite, setPendingInvite] = useState<PendingInvite | null>(null);
  const [gameInvites, setGameInvites] = useState<PendingInvite[]>([]);
  const socketRef = useRef<Socket | null>(null);
  // The socket's auth is a ticket-minting callback now, so the connected user
  // id has to be tracked here to tear the singleton down on logout.
  const connectedUserIdRef = useRef<string | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Consecutive failed handshake attempts, for the backoff below. Reset on
  // every successful connect.
  const retryAttemptRef = useRef(0);

  const clearInvite = useCallback(() => setPendingInvite(null), []);

  const dismissGameInvite = useCallback((roomCode: string) => {
    setGameInvites((prev) => prev.filter((i) => i.roomCode !== roomCode));
  }, []);

  useEffect(() => {
    if (!user) {
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
      }
      setConnected(false);
      setOnlineIds(new Set());
      return;
    }

    const socket = connectSocket(user.id);
    socketRef.current = socket;
    connectedUserIdRef.current = user.id;

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
      void logout().finally(() => router.replace("/auth"));
    };
    setSocketAuthFailureHandler(onAuthFailure);

    const onConnect = () => {
      setConnected(true);
      retryAttemptRef.current = 0;
      socket.emit("friend:get_online_list");
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
      userId,
      online,
    }: {
      userId: string;
      online: boolean;
      lastSeen?: string;
    }) => {
      setOnlineIds((prev) => {
        const next = new Set(prev);
        if (online) {
          next.add(userId);
        } else {
          next.delete(userId);
        }
        return next;
      });
    };

    const onRequestIncoming = ({ from }: { from: string }) => {
      qc.invalidateQueries({ queryKey: ["/api/friends/requests"] });
      showNotification({
        type: "friend_request",
        title: "Richiesta di amicizia",
        message: `${from} vuole essere tuo amico`,
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
        title: "Amicizia accettata!",
        message: `${by} ha accettato la tua richiesta`,
        onPress: () => router.push("/(online)/friends"),
      });
    };

    const onInvite = ({ from, roomCode }: { from: string; roomCode: string }) => {
      setPendingInvite({ from, roomCode });
      setGameInvites((prev) => {
        if (prev.some((i) => i.roomCode === roomCode)) return prev;
        return [...prev, { from, roomCode }];
      });
      showNotification({
        type: "game_invite",
        title: `${from} ti invita a giocare!`,
        message: `Stanza: ${roomCode} — Tocca per unirti`,
        duration: 6000,
        onPress: () => {
          router.push("/(online)");
        },
      });
    };

    // The server rejects/rate-limits invites and other actions with these —
    // previously nothing listened, so e.g. a friend:invite to a non-friend
    // failed silently for the sender.
    // Keep the whole payload: the server emits a stable `code` (plus `params`)
    // alongside the Italian `message`, so the client can render it in the
    // player's own language. `translateServerPayload` falls back to the
    // server's plain text if the code is unknown to this build.
    const onFriendError = (payload: ServerPayload) => {
      showNotification({
        type: "game_error",
        title: t("common.error"),
        message: translateServerPayload(payload),
        duration: 4000,
      });
    };
    const onSocketError = (payload: ServerPayload) => {
      showNotification({
        type: "game_error",
        title: t("common.error"),
        message: translateServerPayload(payload),
        duration: 4000,
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
  }, [user?.id]);

  const contextValue = useMemo(
    () => ({
      socket: socketRef.current,
      connected,
      onlineIds,
      pendingInvite,
      clearInvite,
      gameInvites,
      dismissGameInvite,
    }),
    [connected, onlineIds, pendingInvite, gameInvites]
  );

  return (
    <SocketContext.Provider value={contextValue}>
      {children}
    </SocketContext.Provider>
  );
}
