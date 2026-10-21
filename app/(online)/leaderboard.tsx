// The current season's ladder. Read-only: the rating itself is the content.
// A season can carry up to 50 rows (server/game/ratings.ts), so — like every other
// screen with a back action — the exit sits in a fixed top bar rather than
// only past however much of the board is on screen.
import React, { useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { router } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { MenuLayout, takesSlack } from "@/components/MenuLayout";
import { ScreenHeader } from "@/components/ScreenHeader";
import { MenuCard } from "@/components/MenuCard";
import { MenuButton } from "@/components/MenuButton";
import { SegmentedControl } from "@/components/SegmentedControl";
import { LoadingBlock, ErrorBlock, EmptyBlock } from "@/components/StateBlock";
import { Colors, FontSize, Radius, Spacing, Type } from "@/lib/theme";
import { PROVISIONAL_ROUNDS } from "@/lib/game/rating";
import { RatingSummary } from "@/components/RatingSummary";
import { useTranslation } from "@/lib/i18n";
import { a11yGroup, a11yHidden } from "@/lib/a11y";
import { ladderBoards, queryKey, useApi } from "@/lib/queries";



/** Gold, silver and bronze for the top three; everyone else takes the plain ink. */
const RANK_COLORS = [Colors.podiumGold, Colors.podiumSilver, Colors.podiumBronze];

export default function LeaderboardScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [scope, setScope] = useState<keyof typeof ladderBoards>("global");
  const boardQuery = useApi(ladderBoards[scope]);
  const meQuery = useApi(queryKey("ratings/me"));

  const board = boardQuery.data ?? [];
  const me = meQuery.data;

  return (
    <MenuLayout scrollable centered={false}>
      <ScreenHeader title={t("ladder.title")} />

      <MenuCard grow>
        {meQuery.isLoading && <LoadingBlock label={t("ladder.meLoadingA11yLabel")} />}
        {meQuery.isError && (
          <ErrorBlock
            stale={me !== undefined}
            title={t("ladder.meErrorTitle")}
            retry={{ label: t("common.retry"), a11yLabel: t("ladder.meRetryA11yLabel"), onPress: () => meQuery.refetch() }}
          />
        )}
        {me && <RatingSummary rating={me} style={styles.selfBlock} />}

        <SegmentedControl
          testID="ladder-scope"
          segments={[
            { key: "global", label: t("ladder.scopeGlobal") },
            { key: "friends", label: t("ladder.scopeFriends") },
          ]}
          selected={scope}
          onSelect={setScope}
        />

        <View style={styles.board}>
        {boardQuery.isLoading && <LoadingBlock label={t("ladder.loadingA11yLabel")} />}

        {boardQuery.isError && (
          <ErrorBlock
            stale={boardQuery.data !== undefined}
            title={t("ladder.errorTitle")}
            retry={{ label: t("ladder.errorRetry"), a11yLabel: t("ladder.errorRetry"), onPress: () => boardQuery.refetch() }}
          />
        )}

        {boardQuery.isSuccess && scope === "global" && board.length === 0 && (
          <EmptyBlock
            icon="trophy-outline"
            title={t("ladder.emptyTitle")}
            body={t("ladder.emptyBody", { n: PROVISIONAL_ROUNDS })}
          />
        )}

        {board.length > 0 && (
          <View style={styles.list} testID={`ladder-rows-${scope}`}>
            {board.map((entry) => (
              <View
                key={entry.userId}
                style={[styles.row, entry.userId === user?.id && styles.rowSelf]}
                {...a11yGroup(
                  t(entry.userId === user?.id ? "ladder.rowSelfA11yLabel" : "ladder.rowA11yLabel", {
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

        {boardQuery.isSuccess && scope === "friends" && board.length <= 1 && (
          <>
            <EmptyBlock
              icon="people-outline"
              title={t("ladder.friendsEmptyTitle")}
              body={t("ladder.friendsEmptyBody")}
            />
            <MenuButton
              label={t("ladder.friendsEmptyAction")}
              variant="secondary"
              onPress={() => router.push("/(online)/friends")}
            />
          </>
        )}
        </View>

        <Text style={styles.note}>{t("ladder.rankedOnlyNote")}</Text>
      </MenuCard>
    </MenuLayout>
  );
}

const styles = StyleSheet.create({

  selfBlock: { paddingTop: Spacing.md },

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
