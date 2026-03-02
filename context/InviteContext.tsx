import React, { createContext, useContext, useState, useEffect, useRef } from "react";
import { Alert } from "react-native";
import { router } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { getSocket } from "@/lib/socket";

interface PendingInvite {
  from: string;
  roomCode: string;
}

interface InviteContextValue {
  pendingInvite: PendingInvite | null;
  clearInvite: () => void;
}

const InviteContext = createContext<InviteContextValue>({
  pendingInvite: null,
  clearInvite: () => {},
});

export function useInvite() {
  return useContext(InviteContext);
}

export function InviteProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [pendingInvite, setPendingInvite] = useState<PendingInvite | null>(null);
  const listenerAttached = useRef(false);

  useEffect(() => {
    if (!user) return;
    if (listenerAttached.current) return;

    const socket = getSocket(user.id);
    listenerAttached.current = true;

    const handleInvite = ({ from, roomCode }: { from: string; roomCode: string }) => {
      Alert.alert(
        "Invito di gioco",
        `${from} ti ha invitato a giocare!\nCodice stanza: ${roomCode}`,
        [
          {
            text: "Unisciti",
            onPress: () => {
              setPendingInvite({ from, roomCode });
              router.push("/(online)");
            },
          },
          { text: "Ignora", style: "cancel" },
        ]
      );
    };

    socket.on("friend:invite", handleInvite);

    return () => {
      socket.off("friend:invite", handleInvite);
      listenerAttached.current = false;
    };
  }, [user?.id]);

  const clearInvite = () => setPendingInvite(null);

  return (
    <InviteContext.Provider value={{ pendingInvite, clearInvite }}>
      {children}
    </InviteContext.Provider>
  );
}
