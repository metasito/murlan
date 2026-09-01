// The current season's ladder. Read-only: the rating itself is the content.
// A season can carry up to 50 rows (server/ratings.ts), so — like every other
// screen with a back action — the exit sits in a fixed top bar rather than
// only past however much of the board is on screen.
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { MenuLayout, takesSlack } from "@/components/MenuLayout";
import { ScreenHeader } from "@/components/ScreenHeader";
import { MenuCard } from "@/components/MenuCard";
import { LoadingBlock, ErrorBlock, EmptyBlock } from "@/components/StateBlock";
import { Colors, FontSize, Radius, Spacing, Type } from "@/lib/theme";
import { PROVISIONAL_GAMES, formatSeason } from "@/lib/rating";
import { useTranslation } from "@/lib/i18n";
import { a11yGroup, a11yHidden } from "@/lib/a11y";
import type { LeaderboardEntryDto, RatingDto } from "@/lib/wire";



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
      <ScreenHeader title={t("ladder.title")} />

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
        {boardQuery.isLoading && <LoadingBlock label={t("ladder.loadingA11yLabel")} />}

        {boardQuery.isError && (
          <ErrorBlock
            title={t("ladder.errorTitle")}
            retry={{ label: t("ladder.errorRetry"), a11yLabel: t("ladder.errorRetry"), onPress: () => boardQuery.refetch() }}
          />
        )}

        {boardQuery.isSuccess && board.length === 0 && (
          <EmptyBlock
            icon="trophy-outline"
            title={t("ladder.emptyTitle")}
            body={t("ladder.emptyBody", { n: PROVISIONAL_GAMES })}
          />
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

  // The board is the card's elastic part: the rating above it and the note and
  // the back button below it keep their own heights, so a taller window shows
  // more of the ladder rather than more felt under it.
  board: { ...takesSlack, justifyContent: "center" },
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
