// The card exchange as the *result screen* presents it, between two hands of
// a match — distinct from components/ExchangeModal.tsx, which is the same rule
// during a live table.
//
// Its own file rather than an inner function of app/result.tsx so it can be
// rendered on its own: which branch it shows depends on who won the previous
// hand, and a test that has to win a real hand first to reach the interactive
// branch is a coin flip.
import React, { useEffect, useRef, useState } from "react";
import { Modal, View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { hapticMedium, hapticSelection } from "@/lib/haptics";
import { CardView } from "@/components/CardView";
import { sortHand, getValidGivebackCards, pickGivebackCard } from "@/lib/gameEngine";
import type { GameState } from "@/lib/gameEngine";
import { Colors, FontSize, Radius } from "@/lib/theme";
import { useTranslation } from "@/lib/i18n";
import { cardSpokenName } from "@/lib/cardNames";
import { a11yState } from "@/lib/a11y";

/**
 * Whether the result screen should be showing this overlay at all.
 *
 * `bothJokersException` is set when a hand is *dealt* and is never cleared, so
 * it is still true when that same hand finishes — at which point the result
 * screen would put the two-joker notice up again, stale, over a hand that is
 * already over. Its button then leaves for `/game`, where there is nothing
 * left to play. An exchange belongs to a hand about to start, never to one
 * that has just ended, and `gameOver` is what tells those apart.
 */
export function shouldShowResultExchange(gameState: GameState): boolean {
  if (gameState.gameOver) return false;
  const ep = gameState.exchangePhase;
  return ep?.active === true || ep?.bothJokersException === true;
}

/** How long the AI appears to think before returning its card. */
const AI_PICK_DELAY_MS = 900;
/** How long the two-joker notice sits before the next hand deals itself. */
const BOTH_JOKERS_HOLD_MS = 2500;

export function ResultExchangeOverlay({
  gameState,
  chooseExchangeCard,
}: {
  gameState: GameState;
  chooseExchangeCard: (cardId: string) => void;
}) {
  const { t } = useTranslation();
  const ep = gameState.exchangePhase!;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const autoRef = useRef(false);
  const leftRef = useRef(false);

  /**
   * Leaves for the next hand, at most once.
   *
   * Two independent things want to do this on the two-joker exception: the
   * button, and the timer that moves the game on if nobody presses it.
   * Navigation is not synchronous, so pressing the button does not unmount
   * this overlay before the timer fires — without the guard, the app issues a
   * second `replace` to a route it is already leaving.
   */
  const leaveForNextHand = () => {
    if (leftRef.current) return;
    leftRef.current = true;
    router.replace("/game");
  };
  const winner = gameState.players[ep.winnerIdx];
  const loser = gameState.players[ep.loserIdx];
  const exchangeCards = sortHand(getValidGivebackCards(winner.hand, ep.cardFromLoser?.id));

  useEffect(() => {
    if (ep.bothJokersException) {
      const t = setTimeout(leaveForNextHand, BOTH_JOKERS_HOLD_MS);
      return () => clearTimeout(t);
    }
    if (winner.type === "ai" && !autoRef.current) {
      autoRef.current = true;
      const t = setTimeout(() => {
        const give = pickGivebackCard(winner.hand, ep.cardFromLoser?.id);
        if (give) chooseExchangeCard(give.id);
      }, AI_PICK_DELAY_MS);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot per phase mount; ep/winner/exchangeCards are fixed for this phase's lifetime, chooseExchangeCard is stable
  }, [chooseExchangeCard]);

  if (ep.bothJokersException) {
    return (
      // Both branches gate the next hand, so Escape has nothing to dismiss to
      // and onRequestClose is deliberately inert.
      <Modal
        transparent
        visible
        accessibilityLabel={t("result.bothJokersTitle")}
        supportedOrientations={["portrait", "landscape"]}
        onRequestClose={() => {}}
      >
        <View style={exStyles.overlay}>
          <View style={exStyles.card}>
            <Text style={exStyles.jokerEmoji}>🃏🃏</Text>
            <Text style={exStyles.title}>{t("result.bothJokersTitle")}</Text>
            <Text style={exStyles.subtitle}>
              {t("result.bothJokersBody", { name: winner.name })}
            </Text>
            <Pressable
              onPress={leaveForNextHand}
              style={exStyles.confirmBtn}
              accessibilityRole="button"
              accessibilityLabel={t("result.bothJokersConfirm")}
            >
              <LinearGradient
                colors={[Colors.gold, Colors.goldDark]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={exStyles.confirmGrad}
              >
                <Text style={exStyles.confirmText}>{t("result.bothJokersConfirm")}</Text>
              </LinearGradient>
            </Pressable>
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal
      transparent
      visible
      accessibilityLabel={t("result.exchangeTitle")}
      supportedOrientations={["portrait", "landscape"]}
      onRequestClose={() => {}}
    >
      <View style={exStyles.overlay}>
        <View style={exStyles.card}>
          <Text style={exStyles.title}>{t("result.exchangeTitle")}</Text>
          <View style={exStyles.section}>
            <Text style={exStyles.label}>
              {t("result.exchangeGiveLabel", { loser: loser.name, winner: winner.name })}
            </Text>
            <View style={exStyles.singleCard}>
              <CardView card={ep.cardFromLoser} />
            </View>
          </View>
          {winner.type === "ai" ? (
            <Text style={exStyles.aiChoosing}>{t("result.exchangeAiChoosing", { winner: winner.name })}</Text>
          ) : (
            <View style={exStyles.section}>
              <Text style={exStyles.label}>
                {t("result.exchangeReturnLabel", { winner: winner.name })}
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={exStyles.pickRow}
              >
                {exchangeCards.map((card) => {
                  const picked = selectedId === card.id;
                  return (
                    <Pressable
                      key={card.id}
                      onPress={() => {
                        setSelectedId(card.id);
                        hapticSelection();
                      }}
                      style={[
                        exStyles.pickCardWrap,
                        picked && exStyles.pickCardLifted,
                      ]}
                      accessibilityLabel={cardSpokenName(card, t)}
                      {...a11yState({ role: "radio", selected: picked })}
                    >
                      <CardView card={card} selected={picked} noLift decorative />
                    </Pressable>
                  );
                })}
                {exchangeCards.length === 0 && (
                  <Text style={exStyles.noCards}>{t("result.exchangeNoCards")}</Text>
                )}
              </ScrollView>
              <Pressable
                onPress={() => {
                  if (selectedId) {
                    hapticMedium();
                    chooseExchangeCard(selectedId);
                  }
                }}
                style={[exStyles.confirmBtn, !selectedId && exStyles.confirmBtnDim]}
                disabled={!selectedId}
                accessibilityLabel={t("result.exchangeConfirm")}
                {...a11yState({ role: "button", disabled: !selectedId })}
              >
                <LinearGradient
                  colors={
                    selectedId
                      ? [Colors.gold, Colors.goldDark]
                      : [Colors.bgSurface, Colors.bgSurface]
                  }
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={exStyles.confirmGrad}
                >
                  <Text
                    style={[
                      exStyles.confirmText,
                      !selectedId && { color: Colors.textMuted },
                    ]}
                  >
                    {t("result.exchangeConfirm")}
                  </Text>
                </LinearGradient>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const exStyles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.overlay,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
  },
  card: {
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Colors.border,
    padding: 24,
    width: "88%",
    maxWidth: 420,
    gap: 16,
  },
  title: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.md,
    color: Colors.gold,
    letterSpacing: 2,
    textAlign: "center",
  },
  jokerEmoji: { fontSize: FontSize.xxl, textAlign: "center" },
  subtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: FontSize.sm,
    color: Colors.text,
    textAlign: "center",
    lineHeight: 20,
  },
  section: { gap: 10 },
  label: {
    fontFamily: "Inter_400Regular",
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
  },
  singleCard: { alignItems: "center" },
  aiChoosing: {
    fontFamily: "Inter_400Regular",
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    textAlign: "center",
  },
  pickRow: { maxHeight: 110 },
  pickCardWrap: { marginRight: 8, paddingBottom: 4 },
  pickCardLifted: { transform: [{ translateY: -10 }] },
  noCards: {
    fontFamily: "Inter_400Regular",
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    paddingTop: 8,
  },
  confirmBtn: { borderRadius: Radius.md, overflow: "hidden" },
  confirmBtnDim: { opacity: 0.5 },
  confirmGrad: {
    paddingVertical: 13,
    alignItems: "center",
  },
  confirmText: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.md,
    color: Colors.bgCard,
    letterSpacing: 0.5,
  },
});
