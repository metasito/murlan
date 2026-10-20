// Online game screen — a thin adapter over the shared <GameTable>.
//
// Everything visual lives in components/GameTable.tsx. What is left here is
// exactly what is true online and nowhere else: server acknowledgement of a
// play, reactions, the end-of-match board's rematch vote, and the connection-loss
// states (reconnect notice, a player leaving, a failed rejoin).

import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { leaveNavigation } from "@/context/onlineRouting";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  useOnlineConnection,
  useOnlineExchange,
  useOnlineMatch,
  useOnlineRoom,
  useOnlineTable,
  useOnlineTurnClock,
  useServerError,
} from "@/context/onlineGameHooks";
import { useAuth } from "@/context/AuthContext";
import { ConfirmDialog, type ConfirmRequest } from "@/components/ConfirmDialog";
import { GameTable } from "@/components/GameTable";
import type { MatchRating } from "@/components/table/matchBoard";
import { PROVISIONAL_ROUNDS } from "@/lib/game/rating";
import { vacatedOf } from "@/shared/protocol";
import { railWidth } from "@/components/tableFrame";
import { cardScale } from "@/components/cardFaceModel";
import {
  FloatingReactions,
  ReactionPanel,
  ReactionTrigger,
} from "@/components/ReactionLayer";
import { MenuButton } from "@/components/MenuButton";
import { Colors, FontSize, Reading, Spacing, Type, Layer } from "@/lib/theme";
import { uiFeedback } from "@/lib/device/feedback";
import { useTranslation } from "@/lib/i18n";
import { useCatchUp } from "@/lib/useOwnLink";

/**
 * The veiled wrapper below opens a stacking context, so the 100 and 300 its
 * layers carry stop competing with the game table's own children (the felt at
 * 0 up to the banner band at 50) and order only among themselves. The group
 * therefore has to state its own place above them, rather than inherit one
 * from where it sits in the tree.
 */
const OVERLAY_LAYER_Z = Layer.overlay;

export default function OnlineGameScreen() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { t, translateServerPayload } = useTranslation();
  const { user } = useAuth();
  const {
    gameState,
    mySeatIndex,
    playCards,
    pass,
    sendReaction,
    disconnectedSeats,
    autoPassed,
    leftTable,
    reclaimSeat,
  } = useOnlineTable();
  const { turnSeconds, turnDeadlineMs } = useOnlineTurnClock();
  const { room, isSpectator, entrySource, leaveRoom } = useOnlineRoom();
  const {
    pill,
    reconnectNotice,
    playerLeft,
    clearPlayerLeft,
    retryConnection,
    ownLink,
  } = useOnlineConnection();
  const {
    matchState,
    cumulativeScores,
    placementPoints,
    placementPointsCurrent,
    ratingDeltas,
    roundRecorded,
    ratingsAfter,
    rematchVoteState,
    endMatchVoteState,
    voteRematch,
    voteToEndMatch,
  } = useOnlineMatch();

  const { exchangeAnnouncing, exchangeAnnounceData, giveExchangeCard, acknowledgeExchange } =
    useOnlineExchange();

  const [showReactions, setShowReactions] = useState(false);
  const [confirming, setConfirming] = useState<ConfirmRequest | null>(null);

  const reactionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const catchUp = useCatchUp(ownLink, gameState);
  const error = useServerError("table");

  // Every hook must run unconditionally, before the `if (!gameState)` guard below.

  useEffect(
    () => () => {
      if (reactionTimerRef.current) clearTimeout(reactionTimerRef.current);
    },
    []
  );

  // Another player abandoned the table — there is no match left to play, so
  // this one has no way out but the acknowledgement.
  // Seeded empty: the notice can already be standing when this screen mounts.
  const [announcedLeave, setAnnouncedLeave] = useState(false);
  if (playerLeft !== announcedLeave) {
    setAnnouncedLeave(playerLeft);
    if (playerLeft) {
      setConfirming({
        title: t("onlineGame.playerLeftTitle"),
        body: t("onlineGame.playerLeftBody"),
        confirmLabel: t("onlineGame.backToLobby"),
        onConfirm: () => {
          clearPlayerLeft();
          leaveRoom();
        },
      });
    }
  }

  // No state yet: the first `game:state` is either still in flight or was never
  // coming, because the request that would have produced it was refused. The
  // two are indistinguishable from here, so the screen offers what is right
  // either way — a way off it.
  if (!gameState) {
    return (
      <View style={[styles.connecting, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <ActivityIndicator color={Colors.gold} />
        <Text style={styles.connectingText}>{t("onlineGame.connecting")}</Text>
        <View style={styles.connectingAction}>
          <MenuButton
            label={t("onlineGame.backToLobby")}
            variant="secondary"
            onPress={() => {
              const exit = leaveNavigation({ roomId: room?.roomId ?? null, hasGame: false }, entrySource);
              leaveRoom();
              if (exit) router.replace(exit.to);
            }}
          />
        </View>
      </View>
    );
  }

  // "A seat has been vacated" (docs/GAME-RULES.md § Decisions) — the vote is offered while
  // any seat is currently vacated, matching the server's own gate
  // (NO_VACANCY_TO_END) so the button never outlives what the server allows.
  const anyVacatedSeat = gameState.players.some(vacatedOf);

  const myUserId = user?.id ?? "";
  const hasVotedToEndMatch = endMatchVoteState?.votes.includes(myUserId) ?? false;

  // The tray opens beside the rail's own lower knob, which is where the
  // trigger it belongs to lives.
  const rail = railWidth(insets.left, cardScale(Math.min(width, height)));

  const toggleReactionPanel = () => {
    setShowReactions((v) => !v);
    if (reactionTimerRef.current) clearTimeout(reactionTimerRef.current);
    if (!showReactions) {
      reactionTimerRef.current = setTimeout(
        () => setShowReactions(false),
        Reading.notice
      );
    }
  };

  const leaveAndExit = () => leaveRoom();

  // A match already decided is left without a question: there is nothing to discard.
  const requestLeave = () =>
    matchState.over
      ? leaveAndExit()
      : setConfirming({
          title: t("onlineGame.quitConfirmTitle"),
          body: t("onlineGame.quitConfirmBody"),
          cancelLabel: t("common.cancel"),
          confirmLabel: t("onlineGame.quitConfirmConfirm"),
          destructive: true,
          onConfirm: leaveAndExit,
        });

  const viewerSeat = isSpectator ? 0 : mySeatIndex;
  const roundOnTable = gameState.roundOver && placementPointsCurrent && !matchState.over;
  const myDelta = isSpectator ? undefined : ratingDeltas[myUserId];
  const myRating = ratingsAfter[myUserId];
  // `continues` is false for a match the server closed unscored, which is unrecorded for a
  // reason other than bots.
  const matchRating: MatchRating | undefined =
    myDelta !== undefined
      ? {
          delta: myDelta,
          rating: myRating?.rating,
          provisionalLeft:
            myRating && myRating.rounds < PROVISIONAL_ROUNDS ? PROVISIONAL_ROUNDS - myRating.rounds : undefined,
        }
      : !isSpectator && !roundRecorded && matchState.continues
        ? { notRecorded: true }
        : undefined;
  const nextRoundVotes = rematchVoteState?.votes ?? [];
  const voteRematchNow = () => {
    uiFeedback("medium");
    voteRematch();
  };

  return (
    <GameTable
      gameState={gameState}
      matchOver={matchState.over}
      matchWinners={matchState.winners}
      // Until `game:round_over` lands, `placementPoints` still holds the last round's, and the table decides this one's outcome on them.
      placementPoints={placementPointsCurrent ? placementPoints : undefined}
      matchScore={{ scores: cumulativeScores, target: matchState.target, single: matchState.length === "single" }}
      matchActions={
        placementPointsCurrent
          ? {
              onHome: requestLeave,
              again: matchState.continues
                ? {
                    testID: "btn-rivincita",
                    onPress: voteRematchNow,
                    tally: {
                      voted: nextRoundVotes.includes(user?.id ?? ""),
                      votes: nextRoundVotes.length,
                      total: rematchVoteState?.total ?? gameState.players.length,
                    },
                  }
                : null,
            }
          : undefined
      }
      matchRating={matchRating}
      // A spectator holds no seat, so the table is drawn from seat 0 and told
      // it is being watched. Every hand arrives blank from the server either
      // way; `spectating` is what makes the bottom one draw as backs rather
      // than as an empty hand.
      viewerSeat={viewerSeat}
      spectating={isSpectator}
      disconnectedSeats={disconnectedSeats}
      onPlay={playCards}
      onPass={pass}
      onExchangeGive={giveExchangeCard}
      onQuit={requestLeave}
      turnTimer={{
        seconds: turnSeconds,
        resetKey: String(turnDeadlineMs ?? ""),
        // The server arms its AFK timer on every turn, leading included.
        includeNewTrick: true,
        // No onExpire: the server auto-passes, the client only shows the clock.
      }}
      exchangeAnnouncement={{
        visible: exchangeAnnouncing,
        data: exchangeAnnounceData,
        onDismiss: acknowledgeExchange,
      }}
      railExtra={<ReactionTrigger onPress={toggleReactionPanel} />}
      error={error}
      ownLink={ownLink}
      catchUp={catchUp}
      connection={
        // The viewer's own connection outranks another player's notice: a
        // table that has stopped updating is otherwise indistinguishable from
        // an opponent taking their time.
        pill === "lost"
          ? {
              state: "lost",
              text: t("onlineGame.connectionLost"),
              action: { label: t("common.retry"), onPress: retryConnection },
            }
          : pill === "back"
            ? { state: "back", text: t("onlineGame.backOnline") }
            : pill === "reconnecting"
              ? { state: "reconnecting", text: t("onlineGame.reconnecting") }
              : pill === "reconnected" && reconnectNotice
                ? { state: "reconnected", text: translateServerPayload(reconnectNotice.payload) }
                : null
      }
      autoPassed={autoPassed}
      endMatchVote={
        anyVacatedSeat && !gameState.roundOver
          ? {
              voted: hasVotedToEndMatch,
              votes: endMatchVoteState?.votes.length ?? 0,
              total: endMatchVoteState?.total ?? gameState.players.length,
              onPress: () => {
                uiFeedback("medium");
                if (hasVotedToEndMatch) {
                  voteToEndMatch(false);
                  return;
                }
                setConfirming({
                  title: t("game.endMatchConfirmTitle"),
                  body: t("game.endMatchVoteHint"),
                  cancelLabel: t("common.cancel"),
                  confirmLabel: t("game.endMatchConfirmAction"),
                  destructive: true,
                  onConfirm: () => voteToEndMatch(true),
                });
              },
            }
          : null
      }
      leftTable={
        leftTable ? { reclaiming: leftTable === "reclaiming", onReclaim: reclaimSeat, onLeave: leaveAndExit } : null
      }
      roundVote={
        roundOnTable && !leftTable
          ? {
              voted: nextRoundVotes.includes(user?.id ?? ""),
              votes: nextRoundVotes.length,
              total: rematchVoteState?.total ?? gameState.players.length,
              onPress: voteRematchNow,
              deadline:
                rematchVoteState?.secondsRemaining === undefined
                  ? undefined
                  : { seconds: rematchVoteState.secondsRemaining, resetKey: String(rematchVoteState.deadlineMs ?? "") },
            }
          : null
      }
      overlays={(veiled) => (
        <>
          {/* A <Modal> renders above the settings sheet rather than behind it,
              so the veil would take away the confirmation the sheet just
              asked for. */}
          <ConfirmDialog request={confirming} onClose={() => setConfirming(null)} />

          {/* One veil for the whole slot: these are siblings of the table, and
              a layer added here later is behind the sheet by construction
              rather than by being remembered. */}
          <View
            style={[StyleSheet.absoluteFill, { zIndex: OVERLAY_LAYER_Z }]}
            pointerEvents="box-none"
            {...veiled}
          >
              <FloatingReactions viewerSeat={viewerSeat} playerCount={gameState.players.length} />

            {showReactions && (
              <ReactionPanel
                left={rail + Spacing.sm}
                bottom={insets.bottom + Spacing.sm}
                onSelect={(emoji) => {
                  uiFeedback("light");
                  sendReaction(emoji);
                }}
                onClose={() => setShowReactions(false)}
              />
            )}
          </View>
        </>
      )}
    />
  );
}

/** Keeps the lone button off the screen edges in landscape, where it is the
 *  full width of a phone lying down. */
const CONNECTING_ACTION_W = 280;

const styles = StyleSheet.create({
  connecting: {
    flex: 1,
    backgroundColor: Colors.bg,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.lg,
  },
  connectingText: {
    ...Type.body,
    fontSize: FontSize.md,
    textAlign: "center",
    paddingHorizontal: Spacing.xl,
  },
  connectingAction: { width: CONNECTING_ACTION_W, maxWidth: "100%" },
});
