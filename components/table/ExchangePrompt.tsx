import React from "react";
import { View, StyleSheet } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { TableText } from "./TableText";
import { CardView } from "@/components/CardView";
import type { Card } from "@/lib/gameEngine";
import { cardSpokenName } from "@/lib/cardNames";
import { useTranslation } from "@/lib/i18n";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { A11yStatus, a11yHidden } from "@/lib/a11y";
import { Colors, Motion, Radius, Scrim, Spacing } from "@/lib/theme";

const PROMPT_FS = 13;
const RULE_FS = 10.5;
const RULE_TRACKING = 1.2;
const CARD_SCALE = 0.9;

interface ExchangePromptProps {
  /** The card the loser gave, drawn only for the player who has to answer it. */
  receivedCard?: Card;
  winnerName: string;
  loserName: string;
  /** The viewer is the one who must pick, so the prompt asks rather than reports. */
  viewerIsWinner: boolean;
  viewerIsLoser: boolean;
  /** No card in 3–10, so the engine will take the lowest — say so before the tap. */
  noValidCards?: boolean;
  scale: number;
}

/**
 * The exchange, asked for on the felt itself rather than in a dialog.
 *
 * It lives inside the table's centre band, which is the space left over below
 * the top seat's whole column — so the card cannot land on that seat's name,
 * whatever the window is. That was the condition #532's decision attached to
 * this layout, and it is met by where this sits rather than by a tuned offset.
 *
 * Every seat gets a sentence, not only the two trading: the other players read
 * what is happening from the table alone.
 */
export function ExchangePrompt({
  receivedCard,
  winnerName,
  loserName,
  viewerIsWinner,
  viewerIsLoser,
  noValidCards = false,
  scale,
}: ExchangePromptProps) {
  const { t } = useTranslation();
  const reduceMotion = usePrefersReducedMotion();

  const line = viewerIsWinner
    ? t("exchange.prompt", { name: loserName })
    : viewerIsLoser
      ? t("exchange.waitingForYou", { winner: winnerName })
      : t("exchange.watching", { winner: winnerName, loser: loserName });

  const spoken =
    viewerIsWinner && receivedCard
      ? `${t("exchange.receivedCardA11yLabel", {
          name: loserName,
          card: cardSpokenName(receivedCard, t),
        })}. ${line}`
      : line;

  return (
    <Animated.View
      testID="exchange-prompt"
      entering={reduceMotion ? undefined : FadeIn.duration(Motion.duration.reveal)}
      exiting={reduceMotion ? undefined : FadeOut.duration(Motion.duration.shift)}
      style={styles.root}
    >
      <A11yStatus label={spoken} />
      {viewerIsWinner && receivedCard && (
        <View {...a11yHidden()}>
          <CardView card={receivedCard} scale={scale * CARD_SCALE} noLift decorative />
        </View>
      )}
      <TableText {...a11yHidden()} style={styles.line}>
        {line}
      </TableText>
      {viewerIsWinner && (
        <TableText {...a11yHidden()} style={styles.rule}>
          {t(noValidCards ? "exchange.noValidCards" : "exchange.rule")}
        </TableText>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.snug,
  },
  // Its own plate, for the reason the empty-hand text has one: the lamp moves,
  // so the felt has no reliably dark end for a word to sit on.
  line: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: PROMPT_FS,
    color: Colors.text,
    textAlign: "center",
    backgroundColor: Scrim.heavy,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs,
    overflow: "hidden",
  },
  // The glow says which cards. This says why, which is the half no amount of
  // emphasis on the cards can carry — Murlan's 3-to-10 restriction is its own,
  // and a player arriving from any other climbing game has never met it.
  rule: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: RULE_FS,
    letterSpacing: RULE_TRACKING,
    textTransform: "uppercase",
    color: Colors.gold,
    textAlign: "center",
  },
});
