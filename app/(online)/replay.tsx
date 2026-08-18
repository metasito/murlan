// Replay screen — a third thin adapter over the shared <GameTable>.
//
// It holds one number, the move index, and derives the whole table from it.
// The table is given `spectating`, which is exactly right: a replay has no
// seat and no hand, so every seat draws face-down and no action button exists.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import { GameTable } from "@/components/GameTable";
import { MenuLayout } from "@/components/MenuLayout";
import { MenuCard } from "@/components/MenuCard";
import { MenuButton } from "@/components/MenuButton";
import { replayMoveCount, replayStateAt, type ReplayDto } from "@/lib/replay";
import { Colors, FontSize, Motion, Radius, Spacing, Type } from "@/lib/theme";
import { hapticSelection } from "@/lib/haptics";
import { useTranslation } from "@/lib/i18n";
import { a11yHidden } from "@/lib/a11y";

/** A replay has no actions; the table's handlers are wired to nothing. */
const NOOP = () => {};

export default function ReplayScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [index, setIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);

  const { data: replay, isError, isLoading } = useQuery<ReplayDto>({
    queryKey: [`/api/replays/${id}`],
    enabled: !!id,
  });

  const total = replay ? replayMoveCount(replay) : 0;
  const atEnd = index >= total - 1;

  useEffect(() => {
    if (!playing || atEnd) return;
    const timer = setTimeout(() => setIndex((i) => i + 1), Motion.replayStep);
    return () => clearTimeout(timer);
  }, [playing, atEnd, index]);

  useEffect(() => {
    if (atEnd) setPlaying(false);
  }, [atEnd]);

  const step = useCallback(
    (delta: number) => {
      setPlaying(false);
      setIndex((i) => Math.max(-1, Math.min(i + delta, total - 1)));
      hapticSelection();
    },
    [total]
  );

  const restart = useCallback(() => {
    setPlaying(false);
    setIndex(-1);
    hapticSelection();
  }, []);

  // A player who deleted their account is erased from the stored seat, which
  // keeps no wording of its own (server/storage.ts deleteUser). The label is
  // supplied here so it is in the reader's language rather than the language
  // the hand happened to be played in.
  const named = useMemo(
    () =>
      replay
        ? {
            ...replay,
            seats: replay.seats.map((s) => ({ ...s, name: s.name || t("replay.deletedPlayer") })),
          }
        : null,
    [replay, t]
  );

  const state = useMemo(
    () => (named ? replayStateAt(named, index) : null),
    [named, index]
  );

  if (isLoading) {
    return (
      <MenuLayout>
        <MenuCard title={t("replay.title")}>
          <ActivityIndicator color={Colors.gold} accessibilityLabel={t("replay.loadingA11yLabel")} />
        </MenuCard>
      </MenuLayout>
    );
  }

  if (isError) {
    return (
      <MenuLayout>
        <MenuCard title={t("replay.title")}>
          <Text style={styles.errorTitle}>{t("replay.loadErrorTitle")}</Text>
          <Text style={styles.errorBody}>{t("replay.loadErrorBody")}</Text>
          <MenuButton
            label={t("replay.back")}
            onPress={() => router.back()}
            variant="secondary"
            size="sm"
            accessibilityLabel={t("replay.back")}
          />
        </MenuCard>
      </MenuLayout>
    );
  }

  if (!state) return null;

  return (
    <GameTable
      gameState={state}
      viewerSeat={0}
      spectating
      selectedIds={[]}
      onSelectCard={NOOP}
      onPlay={NOOP}
      onPass={NOOP}
      onQuit={() => router.back()}
      onExchangeGive={NOOP}
      roundLabel={t("replay.title")}
      banners={
        <View style={styles.transport}>
          <TransportButton
            icon="play-skip-back"
            label={t("replay.restartA11yLabel")}
            onPress={restart}
          />
          <TransportButton
            icon="chevron-back"
            label={t("replay.prevA11yLabel")}
            onPress={() => step(-1)}
          />
          <TransportButton
            icon={playing ? "pause" : "play"}
            label={playing ? t("replay.pauseA11yLabel") : t("replay.playA11yLabel")}
            onPress={() => {
              setPlaying((p) => !p);
              hapticSelection();
            }}
          />
          <TransportButton
            icon="chevron-forward"
            label={t("replay.nextA11yLabel")}
            onPress={() => step(1)}
          />
          <Text style={styles.counter}>
            {index < 0 ? t("replay.start") : t("replay.moveOf", { n: index + 1, total })}
          </Text>
        </View>
      }
    />
  );
}

function TransportButton({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.button}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {/* Decorative: the Pressable carries the label, and a labelled control
          must expose exactly one accessible node. */}
      <Ionicons
        name={icon}
        size={FontSize.lg}
        color={Colors.gold}
        {...a11yHidden()}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  transport: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  button: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Radius.sm,
    backgroundColor: Colors.bgSurface,
    borderWidth: 1,
    borderColor: Colors.goldMuted,
  },
  counter: {
    ...Type.caption,
    marginLeft: Spacing.xs,
  },
  errorTitle: {
    ...Type.heading,
    textAlign: "center",
  },
  errorBody: {
    ...Type.body,
    textAlign: "center",
    marginTop: Spacing.sm,
  },
});
