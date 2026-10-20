import React, { useEffect } from "react";
import type { ErrorBoundaryProps } from "expo-router";
import { ErrorFallback } from "@/components/ErrorFallback";
import { useSocketConnection } from "@/context/SocketContext";
import { leaveCrashedTable, type CrashScope } from "@/lib/crashedTable";
import { reportError } from "@/lib/errorReporting";

/**
 * A table route's `ErrorBoundary` export. A crash stops here, inside Auth, Socket
 * and Game, instead of at the root boundary above all of them.
 *
 * Reports from the fallback because expo-router's boundary has no
 * `componentDidCatch`; reportError deduplicates against the global handlers.
 */
export function routeErrorBoundary(scope: CrashScope) {
  return function RouteErrorBoundary({ error, retry }: ErrorBoundaryProps) {
    const socket = useSocketConnection();
    useEffect(() => {
      reportError(error);
    }, [error]);
    return (
      <ErrorFallback
        error={error}
        resetError={() => void retry()}
        leaveTable={() => leaveCrashedTable(scope, socket)}
      />
    );
  };
}
