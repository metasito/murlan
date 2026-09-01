import { Stack, Redirect } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { OnlineGameProvider } from "@/context/OnlineGameContext";
import { View, ActivityIndicator } from "react-native";
import { Colors } from '@/lib/theme';

export default function OnlineLayout() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={Colors.gold} />
      </View>
    );
  }

  if (!user) return <Redirect href="/auth" />;

  return (
    <OnlineGameProvider userId={user.id}>
      <Stack screenOptions={{ headerShown: false, animation: "fade" }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="room" />
        <Stack.Screen name="game" options={{ animation: "slide_from_bottom" }} />
        <Stack.Screen name="friends" />
        <Stack.Screen name="replay" />
        <Stack.Screen name="leaderboard" />
        <Stack.Screen name="history" />
        <Stack.Screen name="quickmatch" options={{ gestureEnabled: false }} />
      </Stack>
    </OnlineGameProvider>
  );
}
