import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useKeepAwake } from "expo-keep-awake";
import { GameTable } from "@/components/GameTable";
import type { GameState } from "@/lib/game/gameEngine";
import { Colors, FontSize, Spacing, TOUCH_TARGET_MIN, Type } from "@/lib/theme";
import { diag } from "@/lib/diagnostics";
import { recorder } from "@/lib/diagnostics/recorder";
import { benchScenarios, type BenchContext } from "@/lib/diagnostics/bench";
import { benchBuild } from "@/lib/diagnostics/build";
import { FrameProbe } from "@/lib/diagnostics/FrameProbe";
import { startJsLag } from "@/lib/diagnostics/jsLag";
import "@/lib/diagnostics/scenarios";

const COPY = { runAll: "Run all" } as const;

const collectorHost = (param: string | undefined) =>
  param ?? (process.env.EXPO_PUBLIC_DOMAIN ? new URL(process.env.EXPO_PUBLIC_DOMAIN).hostname : "127.0.0.1");

export function BenchScreen() {
  useKeepAwake();
  const params = useLocalSearchParams<Record<string, string>>();
  const [table, setTable] = useState<{ state: GameState | null }>({ state: null });
  const [frames, setFrames] = useState(false);
  const [results, setResults] = useState<Record<string, string>>({});
  const shown = useRef<() => void>(() => {});
  const running = useRef(false);
  const autoRan = useRef(false);
  const stopJs = useRef<(() => void) | null>(null);

  const run = useCallback(
    async (only?: string) => {
      if (running.current) return;
      running.current = true;
      recorder.postTo(collectorHost(params.host));
      diag({ k: "build", t: performance.now(), ...benchBuild() });
      const ctx: BenchContext = {
        params,
        showTable: (state) =>
          new Promise((resolve) => {
            shown.current = resolve;
            setTable({ state });
          }),
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        frames: (on) => {
          setFrames(on);
          stopJs.current?.();
          stopJs.current = on ? startJsLag() : null;
        },
      };
      for (const [name, scenario] of benchScenarios()) {
        if (only && only !== name) continue;
        diag({ k: "scenario", t: performance.now(), name, phase: "start" });
        const error = await scenario(ctx).then(() => null, (e: unknown) => String(e));
        diag({ k: "scenario", t: performance.now(), name, phase: "end", error });
        setResults((r) => ({ ...r, [name]: error ?? "done" }));
      }
      running.current = false;
    },
    [params]
  );

  useEffect(() => {
    shown.current();
  }, [table]);
  useEffect(() => {
    if (!params.scenario || autoRan.current) return;
    autoRan.current = true;
    void run(params.scenario === "all" ? undefined : params.scenario);
  }, [params.scenario, run]);

  return (
    <>
      <FrameProbe on={frames} />
      {table.state ? (
        <GameTable
          gameState={table.state}
          viewerSeat={0}
          selectedIds={[]}
          onSelectCard={() => {}}
          onPlay={() => {}}
          onPass={() => {}}
          onExchangeGive={() => {}}
          onQuit={() => router.replace("/bench")}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.page}>
          <Pressable accessibilityRole="button" onPress={() => void run()} style={styles.button}>
            <Text style={styles.text}>{COPY.runAll}</Text>
          </Pressable>
          <Text selectable style={styles.text}>
            {JSON.stringify(results, null, 2)}
          </Text>
        </ScrollView>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  page: { padding: Spacing.lg, gap: Spacing.md, backgroundColor: Colors.bg },
  button: { minWidth: TOUCH_TARGET_MIN, minHeight: TOUCH_TARGET_MIN, padding: Spacing.md, backgroundColor: Colors.bgSurface },
  text: { ...Type.bodyStrong, fontSize: FontSize.sm },
});
