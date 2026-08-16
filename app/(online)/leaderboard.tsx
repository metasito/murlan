// The current season's ladder. Read-only, and deliberately plain: the rating
// itself is the content, so the screen is a list and nothing else.
import React from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { MenuLayout } from "@/components/MenuLayout";
import { MenuCard } from "@/components/MenuCard";
import { MenuButton } from "@/components/MenuButton";
import { Colors, FontSize, Radius, Spacing, Type } from "@/lib/theme";
import { PROVISIONAL_GAMES } from "@/lib/rating";
import { useTranslation } from "@/lib/i18n";

interface LeaderboardEntryDto {
  rank: number;
  userId: string;
  username: string;
  rating: number;
  games: number;
}

interface RatingDto {
  season: string;
  rating: number;
  games: number;
  provisional: boolean;
}

/** Gold, silver and bronze for the top three; everyone else takes the plain ink. */
const RANK_COLORS = [Colors.podiumGold, Colors.podiumSilver, Colors.podiumBronze];

export default function LeaderboardScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const boardQuery = useQuery<LeaderboardEntryDto[]>({
    queryKey: ["/api/ratings/leaderboard"],
  });
  const meQuery = useQuery<RatingDto>({ queryKey: ["/api/ratings/me"] });

  const board = boardQuery.data ?? [];
  const me = meQuery.data;

  return (
    <MenuLayout>
      <MenuCard title={t("ladder.title")}>
        {me && (
          <View style={styles.selfBlock} accessible
            accessibilityLabel={`${t("ladder.ratingLabel")}: ${me.rating}. ${t("ladder.seasonLabel", { season: me.season })}`}
          >
            <Text style={styles.selfRating}>{me.rating}</Text>
            <Text style={styles.selfSeason}>{t("ladder.seasonLabel", { season: me.season })}</Text>
            <Text style={styles.selfGames}>
              {me.provisional
                ? t("ladder.provisional", { n: PROVISIONAL_GAMES - me.games })
                : t("ladder.gamesLabel", { n: me.games })}
            </Text>
          </View>
        )}

        {boardQuery.isLoading && (
          <View style={styles.stateBlock}>
            <ActivityIndicator color={Colors.gold} accessibilityLabel={t("ladder.loadingA11yLabel")} />
          </View>
        )}

        {boardQuery.isError && (
          <View style={styles.stateBlock}>
            <Ionicons name="alert-circle-outline" size={28} color={Colors.textMuted} />
            <Text style={styles.stateTitle}>{t("ladder.errorTitle")}</Text>
            <MenuButton
              label={t("ladder.errorRetry")}
              onPress={() => boardQuery.refetch()}
              variant="secondary"
              size="sm"
              fullWidth={false}
              accessibilityLabel={t("ladder.errorRetry")}
            />
          </View>
        )}

        {boardQuery.isSuccess && board.length === 0 && (
          <View style={styles.stateBlock} accessible
            accessibilityLabel={`${t("ladder.emptyTitle")}. ${t("ladder.emptyBody", { n: PROVISIONAL_GAMES })}`}
          >
            <Ionicons name="trophy-outline" size={28} color={Colors.textMuted} />
            <Text style={styles.stateTitle}>{t("ladder.emptyTitle")}</Text>
            <Text style={styles.stateBody}>{t("ladder.emptyBody", { n: PROVISIONAL_GAMES })}</Text>
          </View>
        )}

        {board.length > 0 && (
          <View style={styles.list}>
            {board.map((entry) => (
              <View
                key={entry.userId}
                style={[styles.row, entry.userId === user?.id && styles.rowSelf]}
                accessible
                accessibilityLabel={t("ladder.rowA11yLabel", {
                  rank: entry.rank,
                  name: entry.username,
                  rating: entry.rating,
                })}
              >
                <Text
                  style={[
                    styles.rank,
                    { color: RANK_COLORS[entry.rank - 1] ?? Colors.textMuted },
                  ]}
                >
                  {entry.rank}
                </Text>
                <Text style={styles.name} numberOfLines={1}>{entry.username}</Text>
                <Text style={styles.rating}>{entry.rating}</Text>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.note}>{t("ladder.rankedOnlyNote")}</Text>
        <MenuButton
          label={t("common.back")}
          onPress={() => router.back()}
          variant="secondary"
          size="sm"
          accessibilityLabel={t("common.back")}
        />
      </MenuCard>
    </MenuLayout>
  );
}

const styles = StyleSheet.create({
  selfBlock: {
    alignItems: "center",
    gap: Spacing.xs / 2,
    paddingVertical: Spacing.md,
  },
  selfRating: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.hero,
    color: Colors.gold,
  },
  selfSeason: { ...Type.label },
  selfGames: { ...Type.caption, textAlign: "center" },

  stateBlock: { alignItems: "center", gap: Spacing.sm, paddingVertical: Spacing.lg },
  stateTitle: { ...Type.subheading },
  stateBody: { ...Type.caption, textAlign: "center" },

  list: { gap: Spacing.xs },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.sm,
    backgroundColor: Colors.bgSurface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  rowSelf: { borderColor: Colors.gold, backgroundColor: Colors.goldMuted },
  rank: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.md,
    minWidth: 28,
    textAlign: "center",
  },
  name: { ...Type.bodyStrong, flex: 1 },
  rating: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.md,
    color: Colors.gold,
  },
  note: { ...Type.caption, textAlign: "center", marginTop: Spacing.sm },
});
