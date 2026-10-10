// Online game screen — a thin adapter over the shared <GameTable>.
//
// Everything visual lives in components/GameTable.tsx. What is left here is
// exactly what is true online and nowhere else: server acknowledgement of a
// play, reactions, the rematch/results overlay, and the connection-loss
// states (reconnect notice, a player leaving, a failed rejoin).

import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  useOnlineConnection,
  useOnlineExchange,
  useOnlineMatch,
  useOnlineRoom,
  useOnlineTable,
  useOnlineTurnClock,
} from "@/context/onlineGameHooks";
import { useAuth } from "@/context/AuthContext";
import { ConfirmDialog, type ConfirmRequest } from "@/components/ConfirmDialog";
import { GameTable } from "@/components/GameTable";
import { vacatedOf } from "@/shared/protocol";
import { computeScreenPads, railWidth } from "@/components/tableFrame";
import { cardScale } from "@/components/cardFaceModel";
import {
  FloatingReactions,
  ReactionPanel,
  ReactionTrigger,
} from "@/components/ReactionLayer";
import { GameOverOverlay } from "@/components/GameOverOverlay";
import { MenuButton } from "@/components/MenuButton";
import { Colors, FontSize, Reading, Spacing, Type, Layer } from "@/lib/theme";
import { uiFeedback } from "@/lib/device/feedback";
import { useTranslation } from "@/lib/i18n";
import { linkPill } from "@/lib/ownLink";
import { useCatchUp } from "@/lib/useOwnLink";

// Read once at module scope, never per-call. EXPO_PUBLIC_ vars are inlined
// at bundle build time, so this only ever takes the fast path in a build the
// E2E harness produced itself (scripts/e2e-server.mjs) — production pacing
// is untouched.
const E2E_FAST = process.env.EXPO_PUBLIC_E2E_FAST === "1";

// Beat before the results overlay covers the final play. A domain hold, not a
// generic UI transition, so it is not a Motion token.
const GAME_OVER_DELAY = E2E_FAST ? 0 : 800;

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
  const { t } = useTranslation();
  const { user } = useAuth();
  const { gameState, mySeatIndex, playCards, pass, sendReaction, disconnectedSeats, autoPassed } =
    useOnlineTable();
  const { turnSeconds, turnDeadlineMs } = useOnlineTurnClock();
  const { isSpectator, entrySource, leaveRoom } = useOnlineRoom();
  const {
    connected,
    error,
    reconnectNotice,
    playerLeft,
    rejoinFailed,
    clearPlayerLeft,
    clearRejoinFailed,
    retryConnection,
    ownLink,
  } = useOnlineConnection();
  const {
    matchState,
    cumulativeScores,
    handScores,
    handScoresCurrent,
    ratingDeltas,
    handRecorded,
    rematchVoteState,
    endMatchVoteState,
    voteRematch,
    voteToEndMatch,
  } = useOnlineMatch();

  const { exchangeAnnouncing, exchangeAnnounceData, giveExchangeCard, acknowledgeExchange } =
    useOnlineExchange();

  const [showReactions, setShowReactions] = useState(false);
  const [showGameOver, setShowGameOver] = useState(false);
  const [confirming, setConfirming] = useState<ConfirmRequest | null>(null);

  const reactionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const catchUp = useCatchUp(ownLink, gameState);
  const pill = linkPill(ownLink, connected, !!reconnectNotice?.back);

  // Every hook must run unconditionally, before the `if (!gameState)` guard below.

  useEffect(
    () => () => {
      if (reactionTimerRef.current) clearTimeout(reactionTimerRef.current);
    },
    []
  );

  // The latch belongs to one game-over, so the game-over passing is what clears
  // it — online this screen is never unmounted between manches, and a latch left
  // standing would let the next one skip its delay.
  const [latchedOver, setLatchedOver] = useState(gameState?.gameOver);
  if (gameState?.gameOver !== latchedOver) {
    setLatchedOver(gameState?.gameOver);
    if (!gameState?.gameOver) setShowGameOver(false);
  }

  useEffect(() => {
    if (!gameState?.gameOver) return;
    const t = setTimeout(() => setShowGameOver(true), GAME_OVER_DELAY);
    return () => clearTimeout(t);
  }, [gameState?.gameOver]);

  const goToLobby = useCallback(() => {
    if (entrySource === "quickmatch") router.replace("/(online)/quickmatch");
    else router.replace("/(online)");
  }, [entrySource]);

  // Another player abandoned the table — there is no game left to play, so
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
          goToLobby();
        },
      });
    }
  }

  // A rejoin the server refused is not the player choosing to leave, so no
  // room:leave: the seat belongs to the 60s disconnect grace until it expires.
  // The context has already dropped the local state and shown the reason; all
  // that is left is getting off a table that is no longer there.
  useEffect(() => {
    if (!rejoinFailed) return;
    goToLobby();
    clearRejoinFailed();
  }, [rejoinFailed, clearRejoinFailed, goToLobby]);

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
              leaveRoom();
              goToLobby();
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

  // The results overlay sits above the table and needs the same safe-area pads
  // the table uses; the table computes its own full frame from the same source.
  const pads = computeScreenPads({ insets });
  // The tray opens beside the rail's own lower knob, which is where the
  // trigger it belongs to lives.
  const rail = railWidth(pads.leftPad, cardScale(Math.min(width, height)));

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

  const leaveAndExit = () => {
    leaveRoom();
    goToLobby();
  };

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
  const mancheOnTable = gameState.gameOver && handScoresCurrent && !matchState.over;
  const resultsShown = showGameOver && gameState.gameOver && matchState.over;
  const nextHandVotes = rematchVoteState?.votes ?? [];

  return (
    <GameTable
      gameState={gameState}
      matchOver={matchState.over}
      matchWinners={matchState.winners}
      handScores={handScores}
      matchScore={
        matchState.length === "single" ? undefined : { scores: cumulativeScores, target: matchState.target }
      }
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
        includeNewRound: true,
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
                ? { state: "reconnected", text: reconnectNotice.text }
                : null
      }
      autoPassed={autoPassed}
      endMatchVote={
        anyVacatedSeat && !gameState.gameOver
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
      mancheVote={
        mancheOnTable
          ? {
              voted: nextHandVotes.includes(user?.id ?? ""),
              votes: nextHandVotes.length,
              total: rematchVoteState?.total ?? gameState.players.length,
              onPress: () => {
                uiFeedback("medium");
                voteRematch();
              },
            }
          : null
      }
      tableCovered={resultsShown}
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
                bottom={pads.bottomPad + Spacing.sm}
                onSelect={(emoji) => {
                  uiFeedback("light");
                  sendReaction(emoji);
                }}
                onClose={() => setShowReactions(false)}
              />
            )}

            {resultsShown && (
              <GameOverOverlay
                gameState={gameState}
                topPad={pads.topPad}
                bottomPad={pads.bottomPad}
                leftPad={pads.leftPad}
                rightPad={pads.rightPad}
                onLeave={requestLeave}
                onVoteRematch={() => {
                  uiFeedback("medium");
                  voteRematch();
                }}
                voteState={rematchVoteState}
                myUserId={user?.id ?? ""}
                mySeatIndex={mySeatIndex}
                cumulativeScores={cumulativeScores}
                handScores={handScores}
                ratingDelta={ratingDeltas[user?.id ?? ""] ?? null}
                handRecorded={handRecorded}
                match={matchState}
                ownLink={ownLink}
                onRetry={retryConnection}
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
