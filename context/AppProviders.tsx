import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { queryClient } from "@/lib/query-client";
import { GameProvider } from "@/context/GameContext";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { SocketProvider } from "@/context/SocketContext";
import { SettingsProvider } from "@/context/SettingsContext";
import { NotificationProvider } from "@/context/NotificationContext";
import { OrientationProvider } from "@/lib/device/orientation";

function AccountNotifications({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  return <NotificationProvider accountId={user?.id}>{children}</NotificationProvider>;
}

/**
 * Every provider the app runs under, in the one order it runs them.
 *
 * ErrorBoundary sits inside SafeAreaProvider: its fallback needs insets to
 * lay itself out. Nothing catches a throw in Settings, Query or SafeArea
 * above it. A table screen's crash stops at its route's own ErrorBoundary
 * export, so the providers below this one stay mounted.
 */
export function AppProviders({ children, random }: { children: React.ReactNode; random?: () => number }) {
  return (
    <SettingsProvider>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          <ErrorBoundary>
            <GestureHandlerRootView style={{ flex: 1 }}>
              <OrientationProvider>
                <AuthProvider>
                  <AccountNotifications>
                    <SocketProvider random={random}>
                      <GameProvider>{children}</GameProvider>
                    </SocketProvider>
                  </AccountNotifications>
                </AuthProvider>
              </OrientationProvider>
            </GestureHandlerRootView>
          </ErrorBoundary>
        </SafeAreaProvider>
      </QueryClientProvider>
    </SettingsProvider>
  );
}
