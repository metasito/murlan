import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { queryClient } from "@/lib/query-client";
import { GameProvider } from "@/context/GameContext";
import { AuthProvider } from "@/context/AuthContext";
import { SocketProvider } from "@/context/SocketContext";
import { SettingsProvider } from "@/context/SettingsContext";
import { NotificationProvider, useNotification } from "@/context/NotificationContext";
import NotificationBanner from "@/components/NotificationBanner";
import { OfflineBanner } from "@/components/OfflineBanner";
import { initLocale } from "@/lib/i18n";
import { useFonts } from "expo-font";
// One subpath per weight: each `@expo-google-fonts` package's root module
// requires every weight and italic it ships, and Metro cannot drop an asset a
// reachable module requires. These six are exactly the families named in
// lib/tokens.ts and the handful of local styles — pinned by
// tests/assetBarrels.test.ts.
import { Rajdhani_500Medium } from "@expo-google-fonts/rajdhani/500Medium";
import { Rajdhani_600SemiBold } from "@expo-google-fonts/rajdhani/600SemiBold";
import { Rajdhani_700Bold } from "@expo-google-fonts/rajdhani/700Bold";
import { Inter_400Regular } from "@expo-google-fonts/inter/400Regular";
import { Inter_500Medium } from "@expo-google-fonts/inter/500Medium";
import { Inter_600SemiBold } from "@expo-google-fonts/inter/600SemiBold";

SplashScreen.preventAutoHideAsync();

function RootLayoutNav() {
  const { notification, dismissNotification } = useNotification();

  return (
    <View style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false, animation: "fade" }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="lobby" />
        <Stack.Screen name="rules" />
        <Stack.Screen name="tutorial" />
        <Stack.Screen name="auth" />
        <Stack.Screen name="(online)" />
        <Stack.Screen name="game" options={{ animation: "slide_from_bottom" }} />
        <Stack.Screen name="result" options={{ animation: "fade" }} />
      </Stack>
      <NotificationBanner notification={notification} onDismiss={dismissNotification} />
      <OfflineBanner />
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Rajdhani_500Medium,
    Rajdhani_600SemiBold,
    Rajdhani_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });
  const [localeReady, setLocaleReady] = React.useState(false);

  useEffect(() => {
    initLocale().finally(() => setLocaleReady(true));
  }, []);

  useEffect(() => {
    if ((fontsLoaded || fontError) && localeReady) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError, localeReady]);

  // The tree renders before the fonts resolve: on web nothing covers the wait
  // (dist/index.html is an empty #root), so blocking here is a blank page for
  // the whole download. Text paints in the fallback face and swaps when the
  // TTFs land. Native still waits behind the splash, which the effect above
  // holds until fonts and locale are both settled.
  if (!localeReady) return null;

  // ErrorBoundary sits inside SafeAreaProvider: its fallback needs insets to
  // lay itself out. ErrorFallback also tolerates their absence, so a crash in
  // the providers above still renders a screen rather than nothing.
  return (
    <SettingsProvider>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          <ErrorBoundary>
            <GestureHandlerRootView style={{ flex: 1 }}>
              <NotificationProvider>
                <AuthProvider>
                  <SocketProvider>
                    <GameProvider>
                      <RootLayoutNav />
                    </GameProvider>
                  </SocketProvider>
                </AuthProvider>
              </NotificationProvider>
            </GestureHandlerRootView>
          </ErrorBoundary>
        </SafeAreaProvider>
      </QueryClientProvider>
    </SettingsProvider>
  );
}
