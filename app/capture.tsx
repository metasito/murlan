// Capture screen — a fourth thin adapter over <GameTable>, for a person
// holding a device.
//
// It exists because nothing this repo can run reaches iOS. Playwright renders
// Chromium and `react-test-renderer` computes no layout and no paint, so the
// only instrument that sees a native-only rendering defect is a human with the
// app open, and the fix loop for one is: name a state, reach it, photograph it.
// `lib/captureStates.ts` names them; this reaches them.
//
// It renders <GameTable> from a state built in memory rather than seeding a
// save and navigating to `/game`, because `/game` runs the AI turn loop: a save
// with the turn on a bot is a bot's turn for about a second — long enough to
// navigate to and not to photograph. Nothing here advances the turn unless the
// swing knob is pressed.
//
// Development builds only. In a production bundle the route renders nothing at
// all, so a capture harness can never be a way into a real player's app.
import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { GameTable } from "@/components/GameTable";
import { MenuLayout } from "@/components/MenuLayout";
import {
  CAPTURE_STATES,
  CAPTURE_VIEWER_SEAT,
  captureGameState,
  captureStateById,
  nextTurn,
} from "@/lib/captureStates";
import { Colors, FontSize, Radius, Spacing, TOUCH_TARGET_MIN, Type } from "@/lib/theme";
import type { GameState } from "@/lib/gameEngine";
import { a11yHidden } from "@/lib/a11y";

/**
 * Its own labels, in English, off the translation layer on purpose: these are
 * read by whoever is taking the capture, never by a player, and a key in three
 * locales for a screen no player can open is three keys to keep in step for
 * nothing.
 */
const COPY = {
  title: "Capture",
  body: "Pick a state, turn the device landscape, and photograph it. One shot per state.",
  swing: "Move the lamp to the next seat",
  unavailable: "The capture screen is a development build only.",
} as const;

export default function CaptureScreen() {
  const { state: stateId } = useLocalSearchParams<{ state?: string }>();
  const picked = captureStateById(stateId);
  // Before the null guard, and before the __DEV__ guard: both branches below
  // return early, and a hook that runs on one render and not the next is the
  // error this ordering exists to prevent.
  const [live, setLive] = useState<GameState | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const seeded = React.useMemo(
    () => (picked ? captureGameState(picked) : null),
    [picked]
  );

  if (!__DEV__) {
    return (
      <MenuLayout>
        <Text style={styles.body}>{COPY.unavailable}</Text>
      </MenuLayout>
    );
  }

  if (!picked || !seeded) return <CaptureList />;

  // Built once per state, not per render: `captureGameState` deals a fresh
  // deck, and a new card object on every render restarts the deal animation
  // the capture is waiting to finish.
  const gameState = live ?? seeded;

  return (
    <GameTable
      gameState={gameState}
      viewerSeat={CAPTURE_VIEWER_SEAT}
      selectedIds={selectedIds}
      onSelectCard={(cardId) =>
        setSelectedIds((ids) =>
          ids.includes(cardId) ? ids.filter((id) => id !== cardId) : [...ids, cardId]
        )
      }
      // A capture is of a frame, not of a hand being played: the table stays on
      // the state it was asked for until the swing knob moves it.
      onPlay={() => {}}
      onPass={() => {}}
      onExchangeGive={() => {}}
      onQuit={() => router.replace("/capture")}
      // The rail's lower knob, where the online table puts reactions. The swing
      // between two lamp positions is a state of its own and the only one that
      // needs an input to reach, so it takes a control that is already part of
      // the chrome rather than an overlay that would sit in the photograph.
      railExtra={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={COPY.swing}
          onPress={() => setLive((s) => ({ ...(s ?? gameState), currentTurnIndex: nextTurn(s ?? gameState) }))}
          style={styles.swing}
        >
          <Ionicons name="arrow-forward" size={SWING_GLYPH} color={Colors.textMuted} />
        </Pressable>
      }
    />
  );
}

function CaptureList() {
  return (
    <MenuLayout>
      <Text style={styles.title}>{COPY.title}</Text>
      <Text style={styles.body}>{COPY.body}</Text>
      <ScrollView contentContainerStyle={styles.list}>
        {CAPTURE_STATES.map((state) => (
          <Pressable
            key={state.id}
            accessibilityRole="button"
            accessibilityLabel={state.label}
            onPress={() => router.push({ pathname: "/capture", params: { state: state.id } })}
            style={styles.row}
          >
            <Text style={styles.rowId} {...a11yHidden()}>{state.id}</Text>
            <Text style={styles.rowLabel} {...a11yHidden()}>{state.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </MenuLayout>
  );
}

const SWING_GLYPH = 20;

const styles = StyleSheet.create({
  title: { ...Type.title, fontSize: FontSize.xl, color: Colors.text, marginBottom: Spacing.sm },
  body: { ...Type.body, fontSize: FontSize.md, color: Colors.textMuted, marginBottom: Spacing.lg },
  list: { gap: Spacing.sm, paddingBottom: Spacing.lg },
  row: {
    minHeight: TOUCH_TARGET_MIN,
    padding: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.bgSurface,
    gap: Spacing.xs,
  },
  rowId: { ...Type.bodyStrong, fontSize: FontSize.md, color: Colors.text },
  rowLabel: { ...Type.body, fontSize: FontSize.sm, color: Colors.textMuted },
  swing: {
    minWidth: TOUCH_TARGET_MIN,
    minHeight: TOUCH_TARGET_MIN,
    alignItems: "center",
    justifyContent: "center",
  },
});
