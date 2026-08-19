// Online game screen — a thin adapter over the shared <GameTable>.
//
// Everything visual lives in components/GameTable.tsx. What is left here is
// exactly what is true online and nowhere else: server acknowledgement of a
// play, reactions, the rematch/results overlay, and the connection-loss
// states (reconnect notice, a player leaving, a failed rejoin).

import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Platform, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useOnlineGame } from "@/context/OnlineGameContext";
import { useAuth } from "@/context/AuthContext";
import { ConfirmDialog, type ConfirmRequest } from "@/components/ConfirmDialog";
import { GameTable } from "@/components/GameTable";
import { TOP_BAR_H, computeScreenPads, readExchange } from "@/components/gameTableModel";
import {
  FloatingReactions,
  ReactionPanel,
  ReactionTrigger,
} from "@/components/ReactionLayer";
import { GameOverOverlay } from "@/components/GameOverOverlay";
import { MenuButton } from "@/components/MenuButton";
import { Colors, FontSize, Radius, Spacing, Type } from "@/lib/theme";
import { hapticLight, hapticMedium } from "@/lib/haptics";
import { useTranslation } from "@/lib/i18n";

// Read once at module scope, never per-call. EXPO_PUBLIC_ vars are inlined
// at bundle build time, so this only ever takes the fast path in a build the
// E2E harness produced itself (scripts/e2e-server.mjs) — production pacing
// is untouched.
const E2E_FAST = process.env.EXPO_PUBLIC_E2E_FAST === "1";

/** How long the emoji picker stays open before hiding itself. */
const REACTION_PANEL_MS = 4000;
/** Beat before the results overlay covers the final play. */
const GAME_OVER_DELAY = E2E_FAST ? 0 : 800;
/** In-game server errors are transient; clear them rather than stacking. */
const ERROR_TOAST_MS = 3000;

export default function OnlineGameScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { user } = useAuth();
  const {
    gameState,
    mySeatIndex,
    turnSeconds,
    turnDeadlineMs,
    isSpectator,
    playerLeft,
    rejoinFailed,
    reconnectNotice,
    connected,
    error,
    clearError,
    playCards,
    pass,
    giveExchangeCard,
    sendReaction,
    leaveRoom,
    voteRematch,
    entrySource,
    rematchVoteState,
    cumulativeScores,
    matchState,
    rematchIntents,
    rematchPromptOpen,
    answerRematch,
    exchangeAnnouncing,
    exchangeAnnounceData,
    acknowledgeExchange,
    clearPlayerLeft,
    clearRejoinFailed,
  } = useOnlineGame();

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
    const t = setTimeout(clearError, ERROR_TOAST_MS);
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
  // every `game:state` and rebuild all 14-27 cards.
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

  const myUserId = user?.id ?? "";
  const myRematchAnswer =
    myUserId in rematchIntents.answers ? rematchIntents.answers[myUserId] : null;

  const exchange = readExchange(gameState, mySeatIndex);
  // The results overlay sits above the table and needs the same safe-area pads
  // the table uses; the table computes its own full frame from the same source.
  const pads = computeScreenPads({ insets, isWeb: Platform.OS === "web" });

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
        REACTION_PANEL_MS
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
      // A spectator holds no seat, so the table is drawn from seat 0 and told
      // it is being watched. Every hand arrives blank from the server either
      // way; `spectating` is what makes the bottom one draw as backs rather
      // than as an empty hand.
      viewerSeat={isSpectator ? 0 : mySeatIndex}
      spectating={isSpectator}
      roundLabel={
        matchState.length === "single"
          ? t("result.singleHandFormat")
          : t("gameTable.formatMatch", { target: matchState.target })
      }
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
      topBarExtra={<ReactionTrigger onPress={toggleReactionPanel} />}
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
        ) : null
      }
      overlays={
        <>
          <ConfirmDialog request={confirming} onClose={() => setConfirming(null)} />

          <FloatingReactions />

          {showReactions && (
            <ReactionPanel
              top={pads.topPad + TOP_BAR_H + Spacing.sm}
              onSelect={(emoji) => {
                hapticLight();
                sendReaction(emoji);
              }}
              onClose={() => setShowReactions(false)}
            />
          )}

          {/* Everyone but the winner waits out the exchange. Offline the AI
              resolves it in under a second, so this exists online only. */}
          {exchange.active && !exchange.viewerIsWinner && (
            <View style={styles.waitOverlay}>
              <View style={styles.waitCard}>
                <Text style={styles.waitGlyph}>🔄</Text>
                <Text style={styles.waitTitle}>{t("onlineGame.exchangeInProgressTitle")}</Text>
                <Text style={styles.waitBody}>
                  {exchange.viewerIsLoser
                    ? t("onlineGame.exchangeWaitAsLoser", { winner: exchange.winner?.name ?? t("onlineGame.theWinner") })
                    : t("onlineGame.exchangeWaitAsOther", {
                        winner: exchange.winner?.name ?? t("onlineGame.theWinner"),
                        loser: exchange.loser?.name ?? t("onlineGame.theLoser"),
                      })}
                </Text>
              </View>
            </View>
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
              onLeave={leaveAndExit}
              onVoteRematch={() => {
                hapticMedium();
                voteRematch();
              }}
              voteState={rematchVoteState}
              myUserId={user?.id ?? ""}
              cumulativeScores={cumulativeScores}
              match={{
                target: matchState.target,
                length: matchState.length,
                over: matchState.over,
                winners: matchState.winners,
                isDraw: matchState.isDraw,
                continues: matchState.continues,
              }}
            />
          )}
        </>
      }
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
    gap: 6,
    backgroundColor: Colors.overlay,
    borderRadius: Radius.md,
    paddingHorizontal: 12,
    paddingVertical: 5,
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

  waitOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.overlay,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
  },
  waitCard: {
    backgroundColor: Colors.feltDark,
    borderRadius: Radius.lg,
    borderWidth: 2,
    borderColor: Colors.goldBorder,
    padding: 28,
    alignItems: "center",
    gap: 12,
    maxWidth: 380,
    width: "80%",
  },
  waitGlyph: { fontSize: 32 },
  waitTitle: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.lg,
    color: Colors.gold,
    letterSpacing: 1,
    textAlign: "center",
  },
  waitBody: {
    fontFamily: "Inter_400Regular",
    fontSize: FontSize.sm,
    color: Colors.text,
    textAlign: "center",
    lineHeight: 20,
  },

  errorToast: {
    position: "absolute",
    bottom: 100,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.dangerScrim,
    borderRadius: Radius.md,
    paddingHorizontal: 14,
    paddingVertical: Spacing.sm,
    zIndex: 300,
    maxWidth: 340,
  },
  errorText: {
    fontFamily: "Inter_500Medium",
    fontSize: FontSize.xs + 1,
    color: Colors.white,
    flexShrink: 1,
  },
});
