// End-of-manche results for the online table. The board itself is
// components/ResultBoard.tsx, which the offline screen (app/result.tsx) draws
// too; this adds what only an online table has — the ready gate for the next
// manche, the rematch tally, and the hand's breakdown.
//
// It is a Modal rather than a route because it covers a live table: offline
// navigates away, online must not.
import React, { useState } from "react";
import { Text, StyleSheet, Pressable } from "react-native";
import { AppModal } from "./AppModal";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { GameState } from "@/lib/gameEngine";
import { standings } from "@/lib/standings";
import { celebratesViewer, celebration, isDrawnHand, handOutcomeFor } from "@/lib/matchState";
import type { OnlineMatchState } from "@/context/OnlineGameContext";
import { Colors, FontSize, Spacing, TOUCH_TARGET_MIN } from "@/lib/theme";
import { useTranslation } from "@/lib/i18n";
import { a11yHidden, a11yState } from "@/lib/a11y";
import { ResultBoard, type ContinueAction, type ResultRow } from "./ResultBoard";
import { HandBreakdown } from "./HandBreakdown";

const TOGGLE_ICON = 14;

export interface RematchVote {
  votes: string[];
  total: number;
}

export function GameOverOverlay({
  gameState,
  topPad,
  bottomPad,
  onLeave,
  onVoteRematch,
  voteState,
  myUserId,
  mySeatIndex,
  cumulativeScores,
  handScores,
  ratingDelta,
  handRecorded,
  match,
}: {
  gameState: GameState;
  topPad: number;
  bottomPad: number;
  onLeave: () => void;
  onVoteRematch: () => void;
  voteState: RematchVote | null;
  myUserId: string;
  /** This device's seat, or -1 for a spectator holding none. */
  mySeatIndex: number;
  /** By engine player id, the identity `rankings` and the winners are in. */
  cumulativeScores: Record<string, number>;
  /** What the manche just played awarded, by engine player id. */
  handScores: Record<string, number>;
  /** What it did to this player's ladder rating, or null for a hand that earned none. */
  ratingDelta: number | null;
  /** Whether the hand just played wrote a `/api/stats/history` row. */
  handRecorded: boolean;
  match: OnlineMatchState;
}) {
  const { t } = useTranslation();
  // Closed until asked for: the breakdown's queries do not run, so reaching
  // the rematch button costs exactly what it costs today.
  const [breakdownOpen, setBreakdownOpen] = useState(false);

  const isTeamMode = gameState.gameMode === "teams";
  const rows: ResultRow[] = standings(
    gameState.rankings.map((id, finishedAt) => ({
      id,
      finishedAt,
      total: cumulativeScores[id] ?? 0,
      points: handScores[id] ?? 0,
    }))
  ).map((row) => {
    const seat = gameState.players.find((p) => p.id === row.id);
    return {
      id: row.id,
      name: seat?.name ?? "",
      team: seat?.team,
      total: row.total,
      points: row.points,
    };
  });

  // A drawn manche (RULES.md §11) has no seat or team to celebrate for it —
  // dropped here rather than left in for `celebration` to reject, since only
  // the manche's own placement is ever tied this way; the match winner (the
  // first candidate) is decided on cumulative points and stands regardless.
  //
  // `mancheDrawn`/`celebratedName` stay on `isDrawnHand` directly rather than
  // `handOutcomeFor`: naming who to celebrate is asked once, for every
  // viewer, with a defensive third tier (`rows[0]?.id`, the match's current
  // leader) for the rare case `rankings[0]` itself fails to resolve —
  // `handOutcomeFor` is deliberately viewer-scoped and has no such tier, so
  // it answers a different question than this one.
  const mancheDrawn = isTeamMode && isDrawnHand(gameState.players, handScores);
  const celebrationCandidates = [
    match.over ? match.winners[0] : undefined,
    mancheDrawn ? undefined : gameState.rankings[0],
    mancheDrawn ? undefined : rows[0]?.id,
  ];
  const celebratedName = celebration(
    gameState.players,
    celebrationCandidates,
    isTeamMode ? (team) => t("lobby.team", { team }) : null
  );
  const viewerId = gameState.players[mySeatIndex]?.id;
  // The haptic is the one question `handOutcomeFor` exists to answer, so it
  // reads that rather than recomputing the same draw/placement check here —
  // the match-winner branch is unaffected, since a decided match is read off
  // `match.winners`, never off this manche's own rankings.
  const viewerCelebrated = match.over
    ? celebratesViewer(gameState.players, celebrationCandidates, viewerId, isTeamMode)
    : handOutcomeFor(gameState.players, gameState.rankings, handScores, viewerId, isTeamMode) ===
      "won";

  // A match the table voted down offers no way to restart it.
  const canContinue = !match.over || match.continues;
  const hasVoted = voteState?.votes.includes(myUserId) ?? false;
  const voteCount = voteState?.votes.length ?? 0;
  const voteTotal = voteState?.total ?? gameState.players.length;

  const primary: ContinueAction | undefined = !canContinue
    ? undefined
    : hasVoted
      ? {
          kind: "waiting",
          label: t("gameOverOverlay.nextHandWaiting", { count: voteCount, total: voteTotal }),
          a11yLabel: t("gameOverOverlay.waitingA11yLabel", {
            count: voteCount,
            total: voteTotal,
          }),
          onPress: onVoteRematch,
          disabled: true,
          testID: "btn-rivincita",
        }
      : match.over
        ? {
            kind: "newMatch",
            label: t("result.newMatch"),
            a11yLabel: t("gameOverOverlay.newMatchA11yLabel"),
            onPress: onVoteRematch,
            testID: "btn-rivincita",
          }
        : {
            kind: "nextHand",
            label: t("result.nextHand"),
            a11yLabel: t("gameOverOverlay.nextHandA11yLabel"),
            onPress: onVoteRematch,
            testID: "btn-rivincita",
          };

  const breakdown = (
    <>
      <Pressable
        onPress={() => setBreakdownOpen((open) => !open)}
        style={styles.breakdownToggle}
        accessibilityLabel={
          breakdownOpen ? t("handBreakdown.hideA11yLabel") : t("handBreakdown.toggleA11yLabel")
        }
        {...a11yState({ role: "button", expanded: breakdownOpen })}
      >
        {breakdownOpen ? (
          <Ionicons
            name="chevron-up"
            size={TOGGLE_ICON}
            color={Colors.gold}
            {...a11yHidden()}
          />
        ) : (
          <Ionicons
            name="chevron-down"
            size={TOGGLE_ICON}
            color={Colors.gold}
            {...a11yHidden()}
          />
        )}
        <Text style={styles.breakdownToggleText} {...a11yHidden()}>
          {t("handBreakdown.toggle")}
        </Text>
      </Pressable>
      {breakdownOpen && (
        <HandBreakdown
          myUserId={myUserId}
          ratingDelta={ratingDelta}
          mancheCanFollow={canContinue}
          handRecorded={handRecorded}
        />
      )}
    </>
  );

  return (
    // The manche is over and every route onward is a control inside this
    // overlay, so Escape has nothing to reveal behind it.
    <AppModal accessibilityLabel={t("result.rankingsTitle")} onRequestClose={() => {}}>
      <ResultBoard
        headerTitle={
          match.over
            ? match.isDraw
              ? t("result.matchDrawTitle")
              : t("result.matchOverTitle")
            : mancheDrawn
              ? t("result.handDrawTitle")
              : t("result.handOverTitle")
        }
        formatLine={
          match.length === "single"
            ? t("result.singleHandFormat")
            : t("result.matchProgress", { target: match.target })
        }
        celebratedName={celebratedName}
        viewerCelebrated={viewerCelebrated}
        celebrationSubtitle={
          match.over
            ? match.isDraw
              ? t("result.matchDrawSubtitle")
              : t("result.matchWinner")
            : mancheDrawn
              ? t("result.handDrawSubtitle")
              : t("result.handWinner")
        }
        rows={rows}
        handCount={match.handsPlayed}
        target={match.length === "single" ? undefined : match.target}
        teams={isTeamMode}
        verdictLine={canContinue ? undefined : t("result.tableStops")}
        home={{
          label: t("gameOverOverlay.leave"),
          a11yLabel: t("gameOverOverlay.leaveA11yLabel"),
          onPress: onLeave,
        }}
        primary={primary}
        footer={breakdown}
        topPad={topPad}
        bottomPad={bottomPad}
      />
    </AppModal>
  );
}

const styles = StyleSheet.create({
  breakdownToggle: {
    minHeight: TOUCH_TARGET_MIN,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
  },
  breakdownToggleText: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: FontSize.xs,
    color: Colors.gold,
    letterSpacing: 0.5,
  },
});
