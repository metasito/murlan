// Online game screen — a thin adapter over the shared <GameTable>.
//
// Everything visual lives in components/GameTable.tsx. What is left here is
// exactly what is true online and nowhere else: server acknowledgement of a
// play, reactions, the rematch/results overlay, and the connection-loss
// states (reconnect notice, a player leaving, a failed rejoin).

import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Platform, Alert } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useOnlineGame } from "@/context/OnlineGameContext";
import { useAuth } from "@/context/AuthContext";
import { GameTable } from "@/components/GameTable";
import { computeScreenPads, readExchange } from "@/components/gameTableModel";
import {
  FloatingReactions,
  ReactionPanel,
  ReactionTrigger,
} from "@/components/ReactionLayer";
import { GameOverOverlay } from "@/components/GameOverOverlay";
import { Colors, FontSize, Radius, Spacing } from "@/lib/theme";
import { hapticLight, hapticMedium } from "@/lib/haptics";
import { useTranslation } from "@/lib/i18n";

/** The server's AFK window (server/socket.ts AFK_TIMEOUT_MS). The client only
 *  displays the countdown — the server owns the timeout and the auto-pass. */
const SERVER_TURN_SECONDS = 30;
/** How long the emoji picker stays open before hiding itself. */
const REACTION_PANEL_MS = 4000;
/** Beat before the results overlay covers the final play. */
const GAME_OVER_DELAY = 800;
/** In-game server errors are transient; clear them rather than stacking. */
const ERROR_TOAST_MS = 3000;

export default function OnlineGameScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { user } = useAuth();
  const {
    gameState,
    reactions,
    mySeatIndex,
    playerLeft,
    rejoinFailed,
    reconnectNotice,
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
    exchangeAnnouncing,
    exchangeAnnounceData,
    acknowledgeExchange,
    clearPlayerLeft,
  } = useOnlineGame();

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showReactions, setShowReactions] = useState(false);
  const [showGameOver, setShowGameOver] = useState(false);

  const reactionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Card ids sent to the server and not yet acknowledged. The selection is only
  // cleared once the server confirms the play, so a rejected move keeps it.
  const pendingPlayRef = useRef<string[] | null>(null);

  const me = gameState?.players[mySeatIndex];

  // Every hook runs unconditionally, before the null guard below. The eleven
  // hooks that used to sit after it guaranteed a "Rendered fewer hooks than
  // expected" crash on any non-null -> null transition (a failed rejoin).

  useEffect(
    () => () => {
      if (reactionTimerRef.current) clearTimeout(reactionTimerRef.current);
    },
    []
  );

  // The played cards leaving my hand is the server's acknowledgement.
  useEffect(() => {
    const pending = pendingPlayRef.current;
    if (!pending || !me) return;
    const handIds = new Set(me.hand.map((c) => c.id));
    if (pending.every((id) => !handIds.has(id))) {
      pendingPlayRef.current = null;
      setSelectedIds([]);
    }
  }, [me?.hand]);

  // A server error means the play was rejected — stop waiting for an ack.
  useEffect(() => {
    if (error) pendingPlayRef.current = null;
  }, [error]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(clearError, ERROR_TOAST_MS);
    return () => clearTimeout(t);
  }, [error]);

  useEffect(() => {
    if (!gameState?.gameOver) {
      setShowGameOver(false);
      return;
    }
    const t = setTimeout(() => setShowGameOver(true), GAME_OVER_DELAY);
    return () => clearTimeout(t);
  }, [gameState?.gameOver]);

  const goToLobby = () => {
    if (entrySource === "quickmatch") router.replace("/(online)/quickmatch");
    else router.replace("/(online)");
  };
  const goToLobbyRef = useRef(goToLobby);
  goToLobbyRef.current = goToLobby;

  // Another player abandoned the table — there is no game left to play.
  useEffect(() => {
    if (!playerLeft) return;
    Alert.alert(
      t("onlineGame.playerLeftTitle"),
      t("onlineGame.playerLeftBody"),
      [
        {
          text: t("onlineGame.backToLobby"),
          onPress: () => {
            clearPlayerLeft();
            leaveRoom();
            goToLobbyRef.current();
          },
        },
      ],
      { cancelable: false }
    );
  }, [playerLeft]);

  useEffect(() => {
    if (!rejoinFailed) return;
    leaveRoom();
    goToLobbyRef.current();
  }, [rejoinFailed]);

  if (!gameState) return null;

  const exchange = readExchange(gameState, mySeatIndex);
  // The results overlay sits above the table and needs the same safe-area pads
  // the table uses; the table computes its own full frame from the same source.
  const pads = computeScreenPads({ insets, isWeb: Platform.OS === "web" });

  const toggleCard = (id: string) =>
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

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
      viewerSeat={mySeatIndex}
      roundLabel={t("onlineGame.roundLabel")}
      selectedIds={selectedIds}
      onSelectCard={toggleCard}
      onPlay={handlePlay}
      onPass={() => {
        pass();
        setSelectedIds([]);
      }}
      onExchangeGive={giveExchangeCard}
      onQuit={() =>
        Alert.alert(
          t("onlineGame.quitConfirmTitle"),
          t("onlineGame.quitConfirmBody"),
          [
            { text: t("common.cancel"), style: "cancel" },
            { text: t("onlineGame.quitConfirmConfirm"), style: "destructive", onPress: leaveAndExit },
          ]
        )
      }
      turnTimer={{
        seconds: SERVER_TURN_SECONDS,
        // The server arms its AFK timer on every turn, leading included.
        includeNewRound: true,
        // No onExpire: the server auto-passes, the client only shows the clock.
      }}
      exchangeAnnouncement={{
        visible: exchangeAnnouncing,
        data: exchangeAnnounceData,
        onDismiss: acknowledgeExchange,
      }}
      topBarExtra={<ReactionTrigger onPress={toggleReactionPanel} />}
      banners={
        reconnectNotice ? (
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
          <FloatingReactions reactions={reactions} />

          {showReactions && (
            <ReactionPanel
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
            />
          )}
        </>
      }
    />
  );
}

const styles = StyleSheet.create({
  reconnectBanner: {
    position: "absolute",
    top: 2,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.overlay,
    borderRadius: Radius.md,
    paddingHorizontal: 12,
    paddingVertical: 5,
    zIndex: 50,
  },
  reconnectBannerText: {
    fontFamily: "Inter_500Medium",
    fontSize: FontSize.xs + 1,
    color: Colors.gold,
  },

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
    // Colors.danger (#E53935) at 0.92 alpha — no translucent danger token exists
    // yet in lib/tokens.ts (only the gold alpha scale does), so this stays a
    // literal anchored to the danger hue rather than an arbitrary red.
    backgroundColor: "rgba(229,57,53,0.92)",
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
