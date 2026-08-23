import { QueryClientProvider } from "@tanstack/react-query";
import { Stack, usePathname } from "expo-router";
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
import { APP_FONTS } from "@/lib/fonts";
import { bindWebAudioUnlock } from "@/lib/sounds";
import { installGlobalErrorHandlers, setCurrentScreen } from "@/lib/errorReporting";
import { playMusic, type MusicTrack } from "@/lib/music";

SplashScreen.preventAutoHideAsync();

/**
 * Which loop belongs to a screen. All four are the same composition, so a
 * change of screen is a change of arrangement rather than a change of music —
 * which is the whole reason one composition was chosen over four (#163).
 *
 * The two game screens both resolve to /game: the `(online)` group is not part
 * of the path, and an online hand should sound like an offline one anyway.
 */
function trackForRoute(pathname: string): MusicTrack {
  if (pathname.startsWith("/result")) return "cue";
  if (pathname.startsWith("/game")) return "hand";
  return "menu";
}

function RootLayoutNav() {
  const { notification, dismissNotification } = useNotification();
  const pathname = usePathname();

  // The reporter is a plain module, so the route reaches it by being pushed
  // rather than read — a crash in a timer has no hook to call.
  useEffect(() => setCurrentScreen(pathname), [pathname]);

  // Requested on every route, started whenever a gesture has unlocked audio.
  // playMusic is a no-op when the track is already the one playing, so this
  // does not restart the loop on an unrelated re-render.
  useEffect(() => {
    void playMusic(trackForRoute(pathname));
  }, [pathname]);

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
        {/* The iOS capture harness (app/capture.tsx). Registered only in a
            development build: the screen refuses to render in a production one
            either way, and a route a player can reach and be shown nothing on
            is worse than no route. */}
        {__DEV__ && <Stack.Screen name="capture" />}
      </Stack>
      <NotificationBanner notification={notification} onDismiss={dismissNotification} />
      <OfflineBanner />
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(APP_FONTS);
  const [localeReady, setLocaleReady] = React.useState(false);

  useEffect(() => {
    initLocale().finally(() => setLocaleReady(true));
  }, []);

  // Binds listeners only — the AudioContext is built inside the gesture they
  // catch. Here rather than on the game screen so the tap that opens a menu
  // already counts.
  useEffect(bindWebAudioUnlock, []);

  // A React error boundary sees render, lifecycle and commit errors and nothing
  // else. Rejected promises, socket callbacks and timers throw past it.
  useEffect(installGlobalErrorHandlers, []);

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
