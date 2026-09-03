import React, { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import type { Card } from "@/lib/gameEngine";
import { useTranslation } from "@/lib/i18n";
import { cardSpokenName } from "@/lib/cardNames";
import { A11yStatus, a11yHidden } from "@/lib/a11y";
import { Colors, FontSize, Radius, Scrim, Spacing } from "@/lib/theme";
import { TableText } from "@/components/table/TableText";
import { exchangeAnnounceMs } from "@/lib/exchangeCeremony";
import type { ExchangeFlight as Trip } from "@/components/gameTableModel";
import { ExchangeFlyingCard, ExchangeSeatTag } from "@/components/table/ExchangeFlight";

interface ExchangeAnnouncementProps {
  visible: boolean;
  winnerName: string;
  loserName: string;
  bothJokersException: boolean;
  /** What the winner chose, travelling to the loser. */
  cardGiven?: Card;
  /** What was taken off the loser, travelling to the winner. */
  cardReceived?: Card;
  /** The loser's card's trip, in the pile's own coordinates. */
  toWinner: Trip;
  /** …and the winner's, which is the same line walked the other way. */
  toLoser: Trip;
  /**
   * Whether the traded cards have arrived — read from the caller rather than
   * timed again here. `readHandArrival` (`components/gameTableModel.ts`) reads
   * the same instant to decide when the receiving hand takes its card back;
   * a second `useTradedCardsLanded` call here once raced it, since two
   * `setTimeout`s scheduled for the same duration from two separate effects
   * are two clocks that can disagree, and this is the one thing they must not.
   */
  landed: boolean;
  scale: number;
  onDismiss: () => void;
}

/**
 * The exchange as it happens, on the table rather than over it.
 *
 * There is no scrim and no panel: the two players not trading are watching this
 * too, and a dialog in front of the felt hides the seats that give the motion
 * its meaning. Each card leaves its owner's seat and arrives at the other's,
 * the two pass side by side at the middle, and a tag lights beside each seat
 * naming what that seat got — which is what a player who looked away can still
 * read afterwards.
 */
export function ExchangeAnnouncement({
  visible,
  winnerName,
  loserName,
  bothJokersException,
  cardGiven,
  cardReceived,
  toWinner,
  toLoser,
  landed,
  scale,
  onDismiss,
}: ExchangeAnnouncementProps) {
  const { t } = useTranslation();
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  });

  useEffect(() => {
    if (!visible) return;
    const done = setTimeout(() => dismissRef.current(), exchangeAnnounceMs(bothJokersException));
    return () => clearTimeout(done);
  }, [visible, bothJokersException]);

  if (!visible) return null;

  const a11yLabel = bothJokersException
    ? t("exchangeAnnouncement.a11yNoSwap", { loserName })
    : [
        cardReceived &&
          t("exchangeAnnouncement.giveLine", {
            from: loserName,
            card: cardSpokenName(cardReceived, t),
            to: winnerName,
          }),
        cardGiven &&
          t("exchangeAnnouncement.giveLine", {
            from: winnerName,
            card: cardSpokenName(cardGiven, t),
            to: loserName,
          }),
      ]
        .filter(Boolean)
        .join(". ");

  return (
    <View testID="exchange-announce" pointerEvents="none" style={styles.layer}>
      <A11yStatus label={a11yLabel} role="alert" live="assertive" />

      {bothJokersException ? (
        <TableText {...a11yHidden()} style={styles.noSwap}>
          {t("exchangeAnnouncement.noSwapText")}
        </TableText>
      ) : (
        <>
          {/* A flier parks at its destination rather than fading, so it is
              retired at the landing — the instant the receiving hand takes the
              card in. The tags below take over for the rest of the notice. */}
          {cardReceived && !landed && (
            <ExchangeFlyingCard
              card={cardReceived}
              trip={toWinner}
              scale={scale}
              testID="exchange-flier-to-winner"
            />
          )}
          {cardGiven && !landed && (
            <ExchangeFlyingCard
              card={cardGiven}
              trip={toLoser}
              scale={scale}
              testID="exchange-flier-to-loser"
            />
          )}

          {cardReceived && (
            <ExchangeSeatTag
              label={t("exchange.seatGot", { card: cardSpokenName(cardReceived, t) })}
              trip={toWinner}
              visible={landed}
              testID="exchange-tag-to-winner"
            />
          )}
          {cardGiven && (
            <ExchangeSeatTag
              label={t("exchange.seatGot", { card: cardSpokenName(cardGiven, t) })}
              trip={toLoser}
              visible={landed}
              testID="exchange-tag-to-loser"
            />
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Sized to nothing and centred on the pile: every child positions itself in
  // the deltas `flightOrigin` speaks, which are measured from that point.
  layer: { position: "absolute", width: 0, height: 0, alignItems: "center", justifyContent: "center" },
  noSwap: {
    position: "absolute",
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: FontSize.sm,
    color: Colors.gold,
    textAlign: "center",
    backgroundColor: Scrim.heavy,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs,
    overflow: "hidden",
  },
});
