// Online game screen — a thin adapter over the shared <GameTable>.
//
// Everything visual lives in components/GameTable.tsx. What is left here is
// exactly what is true online and nowhere else: server acknowledgement of a
// play, reactions, the rematch/results overlay, and the connection-loss
// states (reconnect notice, a player leaving, a failed rejoin).

import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
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
import { cardScale, computeScreenPads, railWidth, vacatedOf } from "@/components/gameTableModel";
import {
  FloatingReactions,
  ReactionPanel,
  ReactionTrigger,
} from "@/components/ReactionLayer";
import { GameOverOverlay } from "@/components/GameOverOverlay";
import { MenuButton } from "@/components/MenuButton";
import { Colors, FontSize, Radius, Reading, Spacing, Type, Layer } from "@/lib/theme";
import { hapticLight, hapticMedium } from "@/lib/haptics";
import { useTranslation } from "@/lib/i18n";
import { A11yStatus, a11yHidden } from "@/lib/a11y";

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
  const { gameState, mySeatIndex, playCards, pass, sendReaction, disconnectedSeats } =
    useOnlineTable();
  const { turnSeconds, turnDeadlineMs } = useOnlineTurnClock();
  const { isSpectator, entrySource, leaveRoom } = useOnlineRoom();
  const {
    connected,
    error,
    reconnectNotice,
    playerLeft,
    rejoinFailed,
    clearError,
    clearPlayerLeft,
    clearRejoinFailed,
  } = useOnlineConnection();
  const {
    matchState,
    cumulativeScores,
    handScores,
    ratingDeltas,
    handRecorded,
    rematchVoteState,
    endMatchVoteState,
    rematchIntents,
    rematchPromptOpen,
    voteRematch,
    voteToEndMatch,
    answerRematch,
  } = useOnlineMatch();

  const { exchangeAnnouncing, exchangeAnnounceData, giveExchangeCard, acknowledgeExchange } =
    useOnlineExchange();

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showReactions, setShowReactions] = useState(false);
  const [showGameOver, setShowGameOver] = useState(false);
  const [confirming, setConfirming] = useState<ConfirmRequest | null>(null);

  const reactionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Card ids sent to the server and not yet acknowledged. The selection is only
  // cleared once the server confirms the play, so a rejected move keeps it.
  const pendingPlayRef = useRef<string[] | null>(null);
  const prevGameOverRef = useRef(false);

  const me = gameState?.players[mySeatIndex];
  const myHand = me?.hand;

  // Every hook must run unconditionally, before the `if (!gameState)` guard below.

  useEffect(
    () => () => {
      if (reactionTimerRef.current) clearTimeout(reactionTimerRef.current);
    },
    []
  );

  // The played cards leaving my hand is the server's acknowledgement.
  useEffect(() => {
    const pending = pendingPlayRef.current;
    if (!pending || !myHand) return;
    const handIds = new Set(myHand.map((c) => c.id));
    if (pending.every((id) => !handIds.has(id))) {
      pendingPlayRef.current = null;
      setSelectedIds([]);
    }
  }, [myHand]);

  // A new manche is a fresh deal, and card ids are deterministic
  // (`${rank}_${suit}`), so an id staged in the hand that just ended can name a
  // real card in the new one — which the table's prune cannot see, because the
  // hand does hold it. The deal is the boundary, so the deal is where it goes.
  useEffect(() => {
    const over = !!gameState?.gameOver;
    const wasOver = prevGameOverRef.current;
    prevGameOverRef.current = over;
    if (wasOver && !over) {
      pendingPlayRef.current = null;
      setSelectedIds([]);
    }
  }, [gameState?.gameOver]);

  // A server error means the play was rejected — stop waiting for an ack.
  useEffect(() => {
    if (error) pendingPlayRef.current = null;
  }, [error]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(clearError, Reading.toast);
    return () => clearTimeout(t);
  }, [error, clearError]);

  useEffect(() => {
    if (!gameState?.gameOver) {
      setShowGameOver(false);
      return;
    }
    const t = setTimeout(() => setShowGameOver(true), GAME_OVER_DELAY);
    return () => clearTimeout(t);
  }, [gameState?.gameOver]);

  const goToLobby = useCallback(() => {
    if (entrySource === "quickmatch") router.replace("/(online)/quickmatch");
    else router.replace("/(online)");
  }, [entrySource]);

  // Another player abandoned the table — there is no game left to play, so
  // this one has no way out but the acknowledgement.
  useEffect(() => {
    if (!playerLeft) return;
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
  }, [playerLeft, clearPlayerLeft, leaveRoom, goToLobby, t]);

  // A rejoin the server refused is not the player choosing to leave, so no
  // room:leave: the seat belongs to the 60s disconnect grace until it expires.
  // The context has already dropped the local state and shown the reason; all
  // that is left is getting off a table that is no longer there.
  useEffect(() => {
    if (!rejoinFailed) return;
    goToLobby();
    clearRejoinFailed();
  }, [rejoinFailed, clearRejoinFailed, goToLobby]);

  // Reaches every card in the hand as `onPress`, through GameTable's own
  // handleCardPress. A fresh arrow per render would change that reference on
  // every `game:state` and rebuild all 13-18 cards.
  const toggleCard = useCallback(
    (id: string) =>
      setSelectedIds((prev) =>
        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      ),
    []
  );

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

  // "A seat has been vacated" (docs/BRIEF.md §3.1) — the vote is offered while
  // any seat is currently vacated, matching the server's own gate
  // (NO_VACANCY_TO_END) so the button never outlives what the server allows.
  const anyVacatedSeat = gameState.players.some(vacatedOf);

  const myUserId = user?.id ?? "";
  const myRematchAnswer =
    myUserId in rematchIntents.answers ? rematchIntents.answers[myUserId] : null;
  const hasVotedToEndMatch = endMatchVoteState?.votes.includes(myUserId) ?? false;

  // The results overlay sits above the table and needs the same safe-area pads
  // the table uses; the table computes its own full frame from the same source.
  const pads = computeScreenPads({ insets });
  // The tray opens beside the rail's own lower knob, which is where the
  // trigger it belongs to lives.
  const rail = railWidth(pads.leftPad, cardScale(Math.min(width, height)));

  const handlePlay = (cardIds: string[]) => {
    // Cleared on acknowledgement, not on send — a server rejection must not
    // cost the player their selection.
    pendingPlayRef.current = cardIds;
    playCards(cardIds);
  };

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

  return (
    <GameTable
      gameState={gameState}
      matchOver={matchState.over}
      handScores={handScores}
      // A spectator holds no seat, so the table is drawn from seat 0 and told
      // it is being watched. Every hand arrives blank from the server either
      // way; `spectating` is what makes the bottom one draw as backs rather
      // than as an empty hand.
      viewerSeat={isSpectator ? 0 : mySeatIndex}
      spectating={isSpectator}
      disconnectedSeats={disconnectedSeats}
      selectedIds={selectedIds}
      onSelectCard={toggleCard}
      onPlay={handlePlay}
      onPass={() => {
        pass();
        setSelectedIds([]);
      }}
      onExchangeGive={giveExchangeCard}
      onQuit={() =>
        setConfirming({
          title: t("onlineGame.quitConfirmTitle"),
          body: t("onlineGame.quitConfirmBody"),
          cancelLabel: t("common.cancel"),
          confirmLabel: t("onlineGame.quitConfirmConfirm"),
          destructive: true,
          onConfirm: leaveAndExit,
        })
      }
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
      rematchPrompt={{
        visible: rematchPromptOpen,
        myAnswer: myRematchAnswer,
        yesCount: rematchIntents.yes,
        seatCount: rematchIntents.total || gameState.players.length,
        onAnswer: answerRematch,
      }}
      railExtra={<ReactionTrigger onPress={toggleReactionPanel} />}
      banners={
        // The viewer's own connection outranks another player's notice: a
        // table that has stopped updating is otherwise indistinguishable from
        // an opponent taking their time.
        !connected ? (
          <View style={[styles.reconnectBanner, styles.reconnectBannerAlert]}>
            <Ionicons name="cloud-offline" size={14} color={Colors.danger} />
            <Text
              style={[styles.reconnectBannerText, styles.reconnectBannerTextAlert]}
              numberOfLines={1}
            >
              {t("onlineGame.reconnecting")}
            </Text>
          </View>
        ) : reconnectNotice ? (
          <View style={styles.reconnectBanner}>
            <Ionicons name="wifi" size={14} color={Colors.gold} />
            <Text style={styles.reconnectBannerText} numberOfLines={1}>
              {reconnectNotice}
            </Text>
          </View>
        ) : anyVacatedSeat && !gameState.gameOver ? (
          <>
            <Pressable
              style={styles.reconnectBanner}
              hitSlop={Spacing.wide}
              accessibilityRole="button"
              accessibilityLabel={
                hasVotedToEndMatch
                  ? t("game.endMatchWithdrawButton")
                  : t("game.endMatchVoteButton")
              }
              accessibilityHint={t("game.endMatchVoteHint")}
              onPress={() => {
                hapticMedium();
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
              }}
            >
              <View style={styles.bannerRow} {...a11yHidden()}>
                <Ionicons name="flag" size={14} color={Colors.gold} />
                <Text style={styles.reconnectBannerText} numberOfLines={1}>
                  {endMatchVoteState
                    ? t("game.endMatchVoteTally", {
                        votes: endMatchVoteState.votes.length,
                        total: endMatchVoteState.total,
                      })
                    : t("game.endMatchVoteButton")}
                </Text>
              </View>
            </Pressable>
            {endMatchVoteState && (
              <A11yStatus
                label={t("game.endMatchVoteTally", {
                  votes: endMatchVoteState.votes.length,
                  total: endMatchVoteState.total,
                })}
                live="polite"
              />
            )}
          </>
        ) : null
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
              <FloatingReactions />

            {showReactions && (
              <ReactionPanel
                left={rail + Spacing.sm}
                bottom={pads.bottomPad + Spacing.sm}
                onSelect={(emoji) => {
                  hapticLight();
                  sendReaction(emoji);
                }}
                onClose={() => setShowReactions(false)}
              />
            )}

            {error && (
              <View style={styles.errorToast} accessibilityLiveRegion="polite">
                <Ionicons name="alert-circle" size={15} color={Colors.white} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {showGameOver && gameState.gameOver && (
              <GameOverOverlay
                gameState={gameState}
                topPad={pads.topPad}
                bottomPad={pads.bottomPad}
                leftPad={pads.leftPad}
                rightPad={pads.rightPad}
                onLeave={leaveAndExit}
                onVoteRematch={() => {
                  hapticMedium();
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

  reconnectBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.slim,
    backgroundColor: Colors.overlay,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.cosy,
    paddingVertical: Spacing.xs,
  },
  reconnectBannerText: {
    fontFamily: "Inter_500Medium",
    fontSize: FontSize.xs + 1,
    color: Colors.gold,
  },
  reconnectBannerAlert: {
    borderWidth: 1,
    borderColor: Colors.danger,
  },
  reconnectBannerTextAlert: { color: Colors.dangerDim },
  bannerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.slim,
  },


  errorToast: {
    position: "absolute",
    bottom: 100,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.slim,
    backgroundColor: Colors.dangerScrim,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.wide,
    paddingVertical: Spacing.sm,
    zIndex: Layer.overlay,
    maxWidth: 340,
  },
  errorText: {
    fontFamily: "Inter_500Medium",
    fontSize: FontSize.xs + 1,
    color: Colors.white,
    flexShrink: 1,
  },
});
