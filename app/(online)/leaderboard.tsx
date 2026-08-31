// The current season's ladder. Read-only: the rating itself is the content.
// A season can carry up to 50 rows (server/ratings.ts), so — like every other
// screen with a back action — the exit sits in a fixed top bar rather than
// only past however much of the board is on screen.
import React from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { MenuLayout, takesSlack } from "@/components/MenuLayout";
import { MenuCard } from "@/components/MenuCard";
import { MenuButton } from "@/components/MenuButton";
import { Colors, FontSize, Radius, Spacing, TOUCH_TARGET_MIN, Type } from "@/lib/theme";
import { PROVISIONAL_GAMES, formatSeason } from "@/lib/rating";
import { useTranslation } from "@/lib/i18n";
import { a11yGroup, a11yHidden } from "@/lib/a11y";

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
  const selfSeason = me ? t("ladder.seasonLabel", { season: formatSeason(me.season, t) }) : "";
  const selfGames = me
    ? me.provisional
      ? t("ladder.provisional", { n: PROVISIONAL_GAMES - me.games })
      : t("ladder.gamesLabel", { n: me.games })
    : "";

  return (
    <MenuLayout scrollable centered={false}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel={t("common.back")}
          hitSlop={12}
        >
          <Ionicons name="chevron-back" size={22} color={Colors.gold} {...a11yHidden()} />
        </Pressable>
        <Text style={styles.screenTitle}>{t("ladder.title")}</Text>
        <View style={{ width: 38 }} />
      </View>

      <MenuCard grow>
        {me && (
          <View
            style={styles.selfBlock}
            {...a11yGroup(
              `${t("ladder.ratingLabel")}: ${me.rating}. ${selfSeason}. ${selfGames}`
            )}
          >
            <Text style={styles.selfRating} {...a11yHidden()}>{me.rating}</Text>
            <Text style={styles.selfSeason} {...a11yHidden()}>{selfSeason}</Text>
            <Text style={styles.selfGames} {...a11yHidden()}>{selfGames}</Text>
          </View>
        )}

        <View style={styles.board}>
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
          <View
            style={styles.stateBlock}
            {...a11yGroup(`${t("ladder.emptyTitle")}. ${t("ladder.emptyBody", { n: PROVISIONAL_GAMES })}`)}
          >
            <Ionicons name="trophy-outline" size={28} color={Colors.textMuted} {...a11yHidden()} />
            <Text style={styles.stateTitle} {...a11yHidden()}>{t("ladder.emptyTitle")}</Text>
            <Text style={styles.stateBody} {...a11yHidden()}>{t("ladder.emptyBody", { n: PROVISIONAL_GAMES })}</Text>
          </View>
        )}

        {board.length > 0 && (
          <View style={styles.list}>
            {board.map((entry) => (
              <View
                key={entry.userId}
                style={[styles.row, entry.userId === user?.id && styles.rowSelf]}
                {...a11yGroup(
                  t("ladder.rowA11yLabel", {
                    rank: entry.rank,
                    name: entry.username,
                    rating: entry.rating,
                  })
                )}
              >
                <Text
                  style={[
                    styles.rank,
                    { color: RANK_COLORS[entry.rank - 1] ?? Colors.textMuted },
                  ]}
                  {...a11yHidden()}
                >
                  {entry.rank}
                </Text>
                <Text style={styles.name} numberOfLines={1} {...a11yHidden()}>{entry.username}</Text>
                <Text style={styles.rating} {...a11yHidden()}>{entry.rating}</Text>
              </View>
            ))}
          </View>
        )}
        </View>

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
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    paddingBottom: Spacing.sm,
    marginBottom: Spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: {
    width: TOUCH_TARGET_MIN,
    height: TOUCH_TARGET_MIN,
    alignItems: "center",
    justifyContent: "center",
  },
  screenTitle: {
    flex: 1,
    textAlign: "center",
    ...Type.heading,
    fontSize: FontSize.xl,
    letterSpacing: 3,
  },

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

  // The board is the card's elastic part: the rating above it and the note and
  // the back button below it keep their own heights, so a taller window shows
  // more of the ladder rather than more felt under it.
  board: { ...takesSlack, justifyContent: "center" },
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
