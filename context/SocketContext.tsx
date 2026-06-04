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
import { connectSocket, disconnectSocket } from "@/lib/socket";
import { useNotification } from "@/context/NotificationContext";
import type { Socket } from "socket.io-client";

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
  const { user } = useAuth();
  const qc = useQueryClient();
  const { showNotification } = useNotification();
  const [connected, setConnected] = useState(false);
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());
  const [pendingInvite, setPendingInvite] = useState<PendingInvite | null>(null);
  const [gameInvites, setGameInvites] = useState<PendingInvite[]>([]);
  const socketRef = useRef<Socket | null>(null);

  const clearInvite = useCallback(() => setPendingInvite(null), []);

  const dismissGameInvite = useCallback((roomCode: string) => {
    setGameInvites((prev) => prev.filter((i) => i.roomCode !== roomCode));
  }, []);

  useEffect(() => {
    if (!user) {
      if (socketRef.current) {
        const uid = (socketRef.current.auth as { userId?: string })?.userId;
        if (uid) disconnectSocket(uid);
        socketRef.current = null;
      }
      setConnected(false);
      setOnlineIds(new Set());
      return;
    }

    const socket = connectSocket(user.id);
    socketRef.current = socket;

    const onConnect = () => {
      setConnected(true);
      socket.emit("friend:get_online_list");
    };

    const onDisconnect = () => {
      setConnected(false);
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

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("friend:online_list", onOnlineList);
    socket.on("friend:status", onFriendStatus);
    socket.on("friend:request_incoming", onRequestIncoming);
    socket.on("friend:request_accepted", onRequestAccepted);
    socket.on("friend:invite", onInvite);

    if (socket.connected) {
      setConnected(true);
      socket.emit("friend:get_online_list");
    }

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("friend:online_list", onOnlineList);
      socket.off("friend:status", onFriendStatus);
      socket.off("friend:request_incoming", onRequestIncoming);
      socket.off("friend:request_accepted", onRequestAccepted);
      socket.off("friend:invite", onInvite);
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
