// What the manche just played did to the player's record, opened from
// <GameOverOverlay> by one tap.
//
// Nothing here is fetched until it is opened: the overlay's primary job is
// rematch-or-leave, and a breakdown that delays that makes the game slower for
// everyone who does not want it (#132).

import React from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import { Colors, FontSize, Radius, Spacing, TOUCH_TARGET_MIN } from "@/lib/theme";
import { useTranslation, type TranslationKey } from "@/lib/i18n";
import { a11yGroup, a11yHidden } from "@/lib/a11y";
import { recentForm } from "@/lib/profileStats";
import { bombsPlayedBy } from "@/lib/replay";
import type { ReplayDto, ReplaySummary } from "@/lib/replay";
import { PROVISIONAL_GAMES } from "@/lib/rating";

// Wire shapes as JSON delivers them — `finishedAt` is an ISO string here, not
// the `Date` shared/schema.ts carries. Same shapes app/profile.tsx
// reads, declared again rather than reached for across a screen boundary.
interface UserStatsDto {
  currentStreak: number;
  bestStreak: number;
}

interface RatingDto {
  rating: number;
  games: number;
  provisional: boolean;
}

interface MatchHistoryDto {
  finishedAt: string;
  placement: number;
  playerCount: number;
  points: number;
  /** Null for a hand the ladder did not rate — never 0, which is a rated hand that moved nobody. */
  ratingDelta: number | null;
}

const POSITION_LABEL_KEYS: TranslationKey[] = [
  "gameOverOverlay.position1",
  "gameOverOverlay.position2",
  "gameOverOverlay.position3",
  "gameOverOverlay.position4",
];
const PLACEMENT_COLORS = [
  Colors.podiumGold,
  Colors.podiumSilver,
  Colors.podiumBronze,
  Colors.textMuted,
];
const placementColor = (placement: number) => PLACEMENT_COLORS[placement - 1] ?? Colors.textMuted;

/** How many finishes the form strip shows here — the overlay is shorter than the profile. */
const FORM_LIMIT = 8;

function Row({
  icon,
  label,
  value,
  valueColor,
  note,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  value: string;
  valueColor?: string;
  note?: string;
}) {
  return (
    <View
      style={styles.row}
      {...a11yGroup(note ? `${label}: ${value}. ${note}` : `${label}: ${value}`)}
    >
      <Ionicons name={icon} size={14} color={Colors.gold} {...a11yHidden()} />
      <Text style={styles.rowLabel} numberOfLines={1} {...a11yHidden()}>
        {label}
      </Text>
      <View style={styles.rowValueBlock}>
        <Text style={[styles.rowValue, valueColor ? { color: valueColor } : null]} {...a11yHidden()}>
          {value}
        </Text>
        {note ? (
          <Text style={styles.rowNote} numberOfLines={2} {...a11yHidden()}>
            {note}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export function HandBreakdown({
  myUserId,
  ratingDelta,
  mancheCanFollow,
}: {
  myUserId: string;
  ratingDelta: number | null;
  /**
   * Another manche can still be dealt at this table. Nothing passes for the
   * viewer while the overlay is up — `handleGameOver` clears the room's timers
   * — but the manche that follows arms a turn (server/gameTimers.ts
   * AFK_TIMEOUT_MS) whether or not they are still looking at the table.
   */
  mancheCanFollow: boolean;
}) {
  const { t } = useTranslation();

  // `staleTime: 0` against the client's default of Infinity: these same keys
  // are cached by the profile screen, and a hand's breakdown reading last
  // week's numbers would be worse than not showing one.
  const fresh = { staleTime: 0 } as const;
  const statsQuery = useQuery<UserStatsDto>({ queryKey: ["/api/stats/me"], ...fresh });
  const historyQuery = useQuery<MatchHistoryDto[]>({ queryKey: ["/api/stats/history"], ...fresh });
  const ratingQuery = useQuery<RatingDto>({ queryKey: ["/api/ratings/me"], ...fresh });
  const replaysQuery = useQuery<ReplaySummary[]>({ queryKey: ["/api/replays"], ...fresh });

  const history = historyQuery.data ?? [];
  // The newest row is *inferred* to be the hand just played: the write is
  // fire-and-forget after `game:over`, so nothing ties a row to this manche.
  // Acceptable for v1 — the rating change, the one number the inference used
  // to get wrong, now arrives on the event itself.
  const thisHand = history[0];
  const newestReplayId = replaysQuery.data?.[0]?.id;

  const replayQuery = useQuery<ReplayDto>({
    queryKey: ["/api/replays", newestReplayId ?? ""],
    enabled: !!newestReplayId,
    ...fresh,
  });

  const anyLoading =
    statsQuery.isLoading || historyQuery.isLoading || ratingQuery.isLoading || replaysQuery.isLoading;
  const anyError =
    statsQuery.isError || historyQuery.isError || ratingQuery.isError || replaysQuery.isError;

  if (anyLoading) {
    return (
      <View style={styles.stateBlock}>
        <ActivityIndicator color={Colors.gold} accessibilityLabel={t("handBreakdown.loadingA11yLabel")} />
      </View>
    );
  }

  if (anyError) {
    return (
      <View style={styles.stateBlock}>
        <Text style={styles.stateTitle}>{t("handBreakdown.errorTitle")}</Text>
        <Pressable
          onPress={() => {
            statsQuery.refetch();
            historyQuery.refetch();
            ratingQuery.refetch();
            replaysQuery.refetch();
          }}
          style={styles.retryBtn}
          accessibilityRole="button"
          accessibilityLabel={t("handBreakdown.retryA11yLabel")}
        >
          <Ionicons name="refresh" size={14} color={Colors.gold} {...a11yHidden()} />
          <Text style={styles.retryText} {...a11yHidden()}>
            {t("handBreakdown.retry")}
          </Text>
        </Pressable>
      </View>
    );
  }

  const rating = ratingQuery.data;
  const stats = statsQuery.data;
  const form = recentForm(history, FORM_LIMIT);
  // `game:over` is the reliable source, but it arrives once: a player who
  // rejoined into a finished table has the row and not the event. The stored
  // column is the same number, subject to the newest-row inference above.
  const delta = ratingDelta ?? thisHand?.ratingDelta ?? null;

  // Absent, not zero: a hand the ladder did not rate (teams, bot-majority, or
  // one without two rated finishers) says so rather than showing "+0", which
  // is a real outcome of a rated hand.
  const ratingValue =
    delta === null || rating === undefined
      ? t("handBreakdown.ratingUnranked")
      : t("handBreakdown.ratingChange", {
          delta: delta > 0 ? `+${delta}` : `${delta}`,
          rating: rating.rating,
        });
  const ratingNote =
    rating && rating.provisional
      ? t("handBreakdown.ratingProvisional", { n: Math.max(PROVISIONAL_GAMES - rating.games, 0) })
      : undefined;

  const streak = stats?.currentStreak ?? 0;

  return (
    <View style={styles.panel}>
      <Row
        icon="trending-up"
        label={t("handBreakdown.ratingLabel")}
        value={ratingValue}
        valueColor={
          delta === null || rating === undefined
            ? Colors.textMuted
            : delta >= 0
              ? Colors.accent
              : Colors.dangerDim
        }
        note={ratingNote}
      />

      {thisHand ? (
        <Row
          icon="flag"
          label={t("handBreakdown.placementLabel")}
          value={t("handBreakdown.placementValue", {
            position: t(POSITION_LABEL_KEYS[thisHand.placement - 1] ?? "gameOverOverlay.position4"),
            players: thisHand.playerCount,
            points: thisHand.points,
          })}
          valueColor={placementColor(thisHand.placement)}
        />
      ) : (
        <Text style={styles.stateBody}>{t("handBreakdown.notRecorded")}</Text>
      )}

      <Row
        icon="flame"
        label={t("handBreakdown.streakLabel")}
        value={
          streak > 0
            ? t("handBreakdown.streakValue", { n: streak, best: stats?.bestStreak ?? 0 })
            : t("handBreakdown.streakNone")
        }
        valueColor={streak > 0 ? Colors.gold : Colors.textMuted}
      />

      {replayQuery.data ? (
        <Row
          icon="nuclear"
          label={t("handBreakdown.bombsLabel")}
          value={`${bombsPlayedBy(replayQuery.data, myUserId)}`}
        />
      ) : null}

      {form.length > 0 && (
        <View
          style={styles.formRow}
          {...a11yGroup(t("handBreakdown.formA11yLabel", { placements: form.join(", ") }))}
        >
          <Ionicons name="stats-chart" size={14} color={Colors.gold} {...a11yHidden()} />
          <Text style={styles.rowLabel} {...a11yHidden()}>
            {t("handBreakdown.formLabel")}
          </Text>
          <View style={styles.formStrip} {...a11yHidden()}>
            {form.map((placement, i) => (
              <View key={i} style={[styles.formPip, { borderColor: placementColor(placement) }]}>
                <Text style={[styles.formPipText, { color: placementColor(placement) }]}>
                  {placement}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {!newestReplayId ? (
        <Text style={styles.stateBody}>{t("handBreakdown.noReplay")}</Text>
      ) : mancheCanFollow ? (
        <Text style={styles.stateBody}>{t("handBreakdown.replayAfterMatch")}</Text>
      ) : (
        <Pressable
          onPress={() => router.push({ pathname: "/(online)/replay", params: { id: newestReplayId } })}
          style={styles.replayBtn}
          accessibilityRole="button"
          accessibilityLabel={t("handBreakdown.openReplayA11yLabel")}
        >
          <Ionicons name="play-circle" size={16} color={Colors.gold} {...a11yHidden()} />
          <Text style={styles.replayText} {...a11yHidden()}>
            {t("handBreakdown.openReplay")}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: Spacing.xs,
    backgroundColor: Colors.bgSurface,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.goldSoft,
    padding: Spacing.snug,
  },
  row: { flexDirection: "row", alignItems: "center", gap: Spacing.xs },
  rowLabel: {
    fontFamily: "Inter_400Regular",
    fontSize: FontSize.xxs,
    color: Colors.textMuted,
    flex: 1,
    minWidth: 0,
  },
  rowValueBlock: { alignItems: "flex-end", flexShrink: 1 },
  rowValue: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.xs,
    color: Colors.text,
  },
  rowNote: {
    fontFamily: "Inter_400Regular",
    fontSize: FontSize.xxs,
    color: Colors.textMuted,
    textAlign: "right",
  },

  formRow: { flexDirection: "row", alignItems: "center", gap: Spacing.xs },
  formStrip: { flexDirection: "row", gap: Spacing.xxs, flexShrink: 1 },
  formPip: {
    width: 18,
    height: 18,
    borderRadius: Radius.full,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  formPipText: { fontFamily: "Rajdhani_700Bold", fontSize: FontSize.xxs },

  stateBlock: {
    alignItems: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.snug,
  },
  stateTitle: {
    fontFamily: "Inter_500Medium",
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
  },
  stateBody: {
    fontFamily: "Inter_400Regular",
    fontSize: FontSize.xxs,
    color: Colors.textMuted,
  },
  retryBtn: {
    minHeight: TOUCH_TARGET_MIN,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.snug,
  },
  retryText: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: FontSize.xs,
    color: Colors.gold,
  },
  replayBtn: {
    minHeight: TOUCH_TARGET_MIN,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.goldBorder,
    paddingHorizontal: Spacing.snug,
  },
  replayText: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: FontSize.xs,
    color: Colors.gold,
  },
});
