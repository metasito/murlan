import { useEffect } from "react";
import { ScrollView, Text } from "react-native";
import type { ErrorBoundaryProps } from "expo-router";
import { Spacing } from "@/lib/theme";
import { reportError } from "@/lib/errorReporting";

const Bench: () => React.ReactElement | null =
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- a static import would ship the bench
  process.env.EXPO_PUBLIC_DIAGNOSTICS === "1" ? require("@/components/BenchScreen").BenchScreen : () => null;

export default Bench;

/**
 * The bench keeps running without its screen, so a render crash here must not strand the phone on the
 * generic fallback: it shows the error, reports it to the collector, and mounts the screen again.
 */
let retries = 0;

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    reportError(error);
    const id = retries++ < 10 ? setTimeout(() => void retry(), 3000) : undefined;
    return () => clearTimeout(id);
  }, [error, retry]);
  return (
    <ScrollView contentContainerStyle={{ padding: Spacing.lg }}>
      <Text selectable>{`Bench screen crashed, retrying:\n${error.message}\n${error.stack ?? ""}`}</Text>
    </ScrollView>
  );
}
