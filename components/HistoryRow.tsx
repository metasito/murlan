// One finished hand, as both the profile's card and the full history screen
// draw it.
import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Colors, FontSize, Radius, Spacing, TOUCH_TARGET_MIN, Type } from "@/lib/theme";
import { useTranslation } from "@/lib/i18n";
import { relativeTime } from "@/lib/relativeTime";
import type { TranslationKey } from "@/lib/i18n";
import { a11yGroup, a11yHidden } from "@/lib/a11y";
import type { GameMode } from "@/lib/gameEngine";

/** Wire shapes as JSON delivers them — `finishedAt` is an ISO string here,
 * not the `Date` server/matchHistoryView.ts holds. */
export interface HistoryParticipantDto {
  name: string | null;
  bot: boolean;
}

export interface MatchHistoryDto {
  id: string;
  userId: string;
  finishedAt: string;
  gameMode: GameMode;
  placement: number;
  playerCount: number;
  points: number;
  opponents: unknown[];
  participants: HistoryParticipantDto[];
  replayId: string | null;
  /** Null for a hand the ladder did not rate — never 0, which is a rated hand that moved nobody. */
  ratingDelta: number | null;
}

const POSITION_LABEL_KEYS: TranslationKey[] = [
  "gameOverOverlay.position1",
  "gameOverOverlay.position2",
  "gameOverOverlay.position3",
  "gameOverOverlay.position4",
];

const PLAY_ICON = 28;

/**
 * Passed the
 * translators rather than calling the hook, so a row inside a list renders
 * without one lookup per row.
 */
export function HistoryRow({ hand }: { hand: MatchHistoryDto }) {
  const { t, tn } = useTranslation();

  const labelKey = POSITION_LABEL_KEYS[hand.placement - 1];
  const posText = labelKey ? t(labelKey) : `${hand.placement}°`;
  const modeText =
    hand.gameMode === "teams"
      ? t("gameOverOverlay.modeTeams")
      : t("gameOverOverlay.modeFreeForAll");
  const timeText = relativeTime(hand.finishedAt, t, tn);
  const pointsText = t("gameOverOverlay.pointsAbbrev", { n: hand.points });
  const playersText = tn("history.players", hand.playerCount);
  const names = hand.participants
    .map((p) => p.name ?? t(p.bot ? "history.botSeat" : "history.unknownSeat"))
    .join(", ");
  const withText = names ? t("history.with", { names }) : "";
  const summary = [
    t("history.rowA11yLabel", {
      position: posText,
      mode: modeText,
      players: playersText,
      points: hand.points,
      time: timeText,
    }),
    withText,
  ]
    .filter(Boolean)
    .join(", ");

  const body = (
    <>
      <View
        style={[styles.posBadge, hand.placement === 1 && styles.posBadgeWinner]}
        {...a11yHidden()}
      >
        <Text
          style={[styles.posBadgeText, hand.placement === 1 && styles.posBadgeTextWinner]}
        >
          {posText}
        </Text>
      </View>
      <View style={styles.rowInfo} {...a11yHidden()}>
        <Text style={styles.rowName}>{modeText} · {playersText}</Text>
        <Text style={styles.rowSub}>{timeText}</Text>
        {withText !== "" && (
          <Text style={styles.rowSub} numberOfLines={1}>{withText}</Text>
        )}
      </View>
      <Text style={styles.rowPoints} {...a11yHidden()}>{pointsText}</Text>
    </>
  );

  // A watchable row is a control, so it carries its label as a button rather
  // than as a group: a group holding a control seals that control inside a
  // leaf on iOS.
  if (hand.replayId === null) {
    return <View style={styles.row} {...a11yGroup(summary)}>{body}</View>;
  }
  return (
    <Pressable
      style={styles.row}
      onPress={() =>
        router.push({ pathname: "/(online)/replay", params: { id: hand.replayId! } })
      }
      accessibilityRole="button"
      accessibilityLabel={t("history.watchA11yLabel", { summary })}
    >
      {body}
      <Ionicons name="play-circle" size={PLAY_ICON} color={Colors.gold} {...a11yHidden()} />
    </Pressable>
  );
}

/** The badge reads at its own size, independent of the row's touch floor. */
const POS_BADGE = 32;
const POS_BADGE_BORDER = 1.5;

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.bgSurface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.sm,
    gap: Spacing.sm,
    minHeight: TOUCH_TARGET_MIN,
  },
  posBadge: {
    width: POS_BADGE,
    height: POS_BADGE,
    borderRadius: Radius.full,
    borderWidth: POS_BADGE_BORDER,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  posBadgeWinner: { borderColor: Colors.gold },
  posBadgeText: { fontFamily: "Rajdhani_700Bold", fontSize: FontSize.sm, color: Colors.textSecondary },
  posBadgeTextWinner: { color: Colors.gold },
  rowInfo: { flex: 1, gap: Spacing.xxs },
  rowName: { ...Type.bodyStrong },
  rowSub: { ...Type.caption },
  rowPoints: { fontFamily: "Rajdhani_700Bold", fontSize: FontSize.md, color: Colors.gold },
});
