import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useKeepAwake } from "expo-keep-awake";
import { GameTable } from "@/components/GameTable";
import { NOTICE_GALLERY, type NoticeFixture } from "@/components/table/notices/gallery";
import type { NoticeKind } from "@/components/table/noticeModel";
import { NoticeSource } from "@/components/table/TableNotice";
import type { GameState } from "@/lib/game/gameEngine";
import { Colors, FontSize, Layer, Spacing, TOUCH_TARGET_MIN, Type } from "@/lib/theme";
import { feltOnly, legibilityRing } from "@/components/table/legibilityRing";
import { benchHandles, diag } from "@/lib/diagnostics";
import { LAMP_SIDES, annulusLuminance, type LampSide } from "@/lib/diagnostics/lampLegibility";
import { recorder } from "@/lib/diagnostics/recorder";
import { benchScenarios, type BenchContext, type NoticeShot } from "@/lib/diagnostics/bench";
import { benchBuild } from "@/lib/diagnostics/build";
import { FrameProbe, armFrames, recordFrames } from "@/lib/diagnostics/FrameProbe";
import { startJsLag } from "@/lib/diagnostics/jsLag";
import { probe } from "@/lib/diagnostics/probe";
import "@/lib/diagnostics/scenarios";

const COPY = { runAll: "Run all" } as const;

async function feltSample(): Promise<Record<LampSide, number>> {
  const table = benchHandles.tableAnchors?.();
  const pixels = await benchHandles.feltSnapshot?.();
  if (!table || !pixels) throw new Error(`no ${table ? "felt snapshot" : "table anchors"} to sample`);
  const perPt = pixels.width / table.width;
  const felt = feltOnly(pixels, perPt);
  const ring = legibilityRing(table.width, table.height);
  return Object.fromEntries(LAMP_SIDES.map((side) => [side, annulusLuminance(felt, table.anchors[side], perPt, ring)])) as Record<LampSide, number>;
}

const GALLERY = Object.fromEntries(Object.entries(NOTICE_GALLERY).map(([kind, fixtures]) => [kind, fixtures.map((f) => f.name)]));

/** Its own state, so a fixture shown or hidden renders the fixture alone and never the table beneath. */
function GalleryStage({ bind }: { bind: (show: (shot: NoticeShot | null) => void) => void }) {
  const [shot, setShot] = useState<NoticeShot | null>(null);
  useEffect(() => bind(setShot), [bind]);
  if (!shot) return null;
  const fixture = (NOTICE_GALLERY[shot.kind as NoticeKind] as NoticeFixture[])[shot.fixture];
  return (
    <View pointerEvents="none" style={styles.stage}>
      <NoticeSource.Provider value="gallery">{fixture.render(1)}</NoticeSource.Provider>
    </View>
  );
}

const collectorHost = (param: string | undefined) =>
  param ?? (process.env.EXPO_PUBLIC_DOMAIN ? new URL(process.env.EXPO_PUBLIC_DOMAIN).hostname : "127.0.0.1");

export function BenchScreen() {
  useKeepAwake();
  const params = useLocalSearchParams<Record<string, string>>();
  const [table, setTable] = useState<{ state: GameState | null }>({ state: null });
  const [results, setResults] = useState<Record<string, string>>({});
  const shown = useRef<() => void>(() => {});
  const running = useRef(false);
  const autoRan = useRef(false);
  const stopJs = useRef<(() => void) | null>(null);
  const showNotice = useRef<(shot: NoticeShot | null) => void>(() => {});
  const bindStage = useCallback((show: (shot: NoticeShot | null) => void) => {
    showNotice.current = show;
  }, []);

  const run = useCallback(
    async (only?: string[]) => {
      if (running.current) return;
      running.current = true;
      recorder.postTo(collectorHost(params.host));
      const capturing = params.capture !== "0" && probe.canCapture() && (await probe.startCapture(true).catch(() => false));
      const drain = setInterval(() => probe.drain(), 1000);
      diag({ k: "build", t: performance.now(), ...benchBuild() });
      const ctx: BenchContext = {
        params,
        showTable: (state) =>
          new Promise((resolve) => {
            shown.current = resolve;
            setTable({ state });
          }),
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        frames: (on, until) => {
          recordFrames(on, until);
          stopJs.current?.();
          stopJs.current = on ? startJsLag() : null;
        },
        armFrames,
        feltSample,
        gallery: GALLERY,
        showNotice: (shot) => showNotice.current(shot),
      };
      for (const [name, scenario] of benchScenarios()) {
        if (only && !only.includes(name)) continue;
        diag({ k: "scenario", t: performance.now(), name, phase: "start" });
        diag({ k: "latency", t: performance.now(), outputMs: probe.outputLatencyMs(), ioMs: probe.ioBufferMs(), inputMs: probe.inputLatencyMs() });
        const error = await scenario(ctx).then(() => null, (e: unknown) => String(e));
        diag({ k: "scenario", t: performance.now(), name, phase: "end", error });
        setResults((r) => ({ ...r, [name]: error ?? "done" }));
      }
      clearInterval(drain);
      probe.drain();
      if (capturing) await probe.stopCapture().catch(() => false);
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
    void run(params.scenario === "all" ? undefined : params.scenario.split(","));
  }, [params.scenario, run]);

  return (
    <>
      <FrameProbe />
      {table.state ? (
        <GameTable
          gameState={table.state}
          viewerSeat={0}
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
      <GalleryStage bind={bindStage} />
    </>
  );
}

const styles = StyleSheet.create({
  page: { padding: Spacing.lg, gap: Spacing.md, backgroundColor: Colors.bg },
  stage: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", zIndex: Layer.alert },
  button: { minWidth: TOUCH_TARGET_MIN, minHeight: TOUCH_TARGET_MIN, padding: Spacing.md, backgroundColor: Colors.bgSurface },
  text: { ...Type.bodyStrong, fontSize: FontSize.sm },
});
