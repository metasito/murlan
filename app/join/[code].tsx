import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { Redirect, useLocalSearchParams } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { useSocket } from "@/context/SocketContext";
import { joinCode, joinRouteFor } from "@/lib/deepLink";
import { Colors } from "@/lib/theme";

export default function JoinScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { user, loading } = useAuth();
  const { acceptInvite } = useSocket();
  const roomCode = joinCode(code);
  const signedIn = user !== null;

  useEffect(() => {
    if (signedIn && roomCode) acceptInvite(roomCode);
  }, [signedIn, roomCode, acceptInvite]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={Colors.gold} />
      </View>
    );
  }
  if (!roomCode) return <Redirect href="/" />;
  if (!signedIn) return <Redirect href={{ pathname: "/auth", params: { next: joinRouteFor(roomCode) } }} />;
  return <Redirect href="/(online)" />;
}
