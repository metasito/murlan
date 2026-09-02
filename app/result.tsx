import React, { useEffect } from "react";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { hapticLight, hapticMedium } from "@/lib/haptics";
import { useLocalMatch, useLocalSession, useLocalTable } from "@/context/gameHooks";
import { standings } from "@/lib/standings";
import { celebratesViewer, celebration, isDrawnHand } from "@/lib/matchState";
import { ResultBoard, type ContinueAction, type ResultRow } from "@/components/ResultBoard";
import { Spacing } from "@/lib/theme";
import { useTranslation } from "@/lib/i18n";

export default function ResultScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { gameState } = useLocalTable();
  const { match, tableWantsRematch, startNextHand, startNewMatch } = useLocalMatch();
  const { resetGame } = useLocalSession();

  useEffect(() => {
    if (!gameState) router.replace("/");
  }, [gameState]);

  if (!gameState) return null;

  const isTeamMode = gameState.gameMode === "teams";
  const isSingleHand = match.length === "single";

  // Scores are folded into the match by GameContext the moment the manche
  // ends, so this screen only reads them.
  const lastHand = match.hands[match.hands.length - 1];
  const handPoints = lastHand?.pointsAwarded ?? {};
  const finishOrder = lastHand?.rankings ?? [];
  const rows: ResultRow[] = standings(
    gameState.players.map((player) => {
      const at = finishOrder.indexOf(player.id);
      return {
        player,
        total: match.scores[player.id] ?? 0,
        points: handPoints[player.id] ?? 0,
        // A seat absent from the manche's order sorts last among equals.
        finishedAt: at === -1 ? finishOrder.length : at,
      };
    })
  ).map((row) => ({
    id: row.player.id,
    name: row.player.name,
    team: row.player.team,
    total: row.total,
    points: row.points,
  }));

  // A drawn manche (RULES.md §11) has no seat or team to celebrate for it —
  // dropped here rather than left in for `celebration` to reject, since only
  // the manche's own placement is ever tied this way; the match winner (the
  // first candidate) is decided on cumulative points and stands regardless.
  const mancheDrawn = isTeamMode && isDrawnHand(gameState.players, handPoints);
  const celebrationCandidates = [
    match.over ? match.winners[0] : undefined,
    mancheDrawn ? undefined : lastHand?.rankings[0],
    mancheDrawn ? undefined : rows[0]?.id,
  ];
  const celebratedName = celebration(
    gameState.players,
    celebrationCandidates,
    isTeamMode ? (team) => t("lobby.team", { team }) : null
  );
  // Pass-and-play seats every human at the same device, so a win by any one
  // of them — not only the first — is this device's win.
  const viewerCelebrated = gameState.players.some(
    (p) =>
      p.type === "human" &&
      celebratesViewer(gameState.players, celebrationCandidates, p.id, isTeamMode)
  );

  const handleHome = () => {
    hapticLight();
    resetGame();
    router.replace("/");
  };
  const goPlay = (start: () => void) => () => {
    hapticMedium();
    start();
    router.replace("/game");
  };

  // The table was asked during the closing manche; a majority "no" ends it
  // here, so there is no button offering to overrule them.
  const primary: ContinueAction | undefined = !match.over
    ? {
        kind: "nextHand",
        label: t("result.nextHand"),
        onPress: goPlay(startNextHand),
        testID: "btn-prossima-manche",
      }
    : tableWantsRematch
      ? {
          kind: "newMatch",
          label: t("result.newMatch"),
          onPress: goPlay(startNewMatch),
          testID: "btn-nuova-partita",
        }
      : undefined;

  // A floor, not just the real inset: on a notchless device (most desktop
  // browsers) env(safe-area-inset-*) is genuinely 0, and content flush
  // against the browser's raw edge is not a safe area, it's a missing margin.
  return (
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
        isSingleHand
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
      handCount={match.hands.length}
      target={isSingleHand ? undefined : match.target}
      teams={isTeamMode}
      verdictLine={
        match.over
          ? tableWantsRematch
            ? t("result.tableContinues")
            : t("result.tableStops")
          : undefined
      }
      home={{ label: t("result.home"), onPress: handleHome, testID: "btn-home" }}
      primary={primary}
      topPad={Math.max(insets.top, Spacing.roomy)}
      bottomPad={Math.max(insets.bottom, Spacing.roomy)}
      leftPad={insets.left}
      rightPad={insets.right}
    />
  );
}
