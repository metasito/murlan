import { Fragment, useEffect, useRef } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Layer, Reading } from "@/lib/theme";
import { useTranslation } from "@/lib/i18n";
import { a11yHidden, A11yStatus } from "@/lib/a11y";
import { getCardDisplayRank, getSuitSymbol, type StartReason } from "@/lib/game/gameEngine";
import { NoticeDim, NoticeDisc, NoticeLine, NoticeName, NoticeTile, TableNotice } from "../TableNotice";
import { panelParts } from "../noticeModel";

const GATE_Z = Layer.hint;
const PANEL_Z = Layer.hint + 1;
const NAME = "\u0000";

type TFunction = ReturnType<typeof useTranslation>["t"];
type WhoStarts = { reason: StartReason; starterName: string; starterIsViewer: boolean };

function whoStartsWords(t: TFunction, { reason, starterName, starterIsViewer }: WhoStarts) {
  const card = reason.type === "start_card" ? reason.card : undefined;
  const rank = card ? getCardDisplayRank(card.rank) : "";
  const suit = card ? getSuitSymbol(card.suit) : "";
  const sub = card && !(card.rank === "3" && card.suit === "spades") ? t("gameShared.startReasonCardSub") : "";
  const main =
    card && starterIsViewer
      ? t("gameTable.startCardBannerSelf", { rank, suit })
      : t(
          reason.type === "lost_round"
            ? "gameShared.startReasonLostRound"
            : reason.type === "won_no_swap"
              ? "gameShared.startReasonWonNoSwap"
              : "gameShared.startReasonCard",
          { name: NAME, rank, suit }
        );
  const runs = main.split(NAME);
  return { card, rank, runs, sub, spoken: [runs.join(starterName), sub].filter(Boolean).join(". ") };
}

export function WhoStartsCard({ gated, scale, ...who }: WhoStarts & { gated: boolean; scale: number }) {
  const { t } = useTranslation();
  const { card, rank, runs, sub } = whoStartsWords(t, who);
  const part = panelParts(scale);
  return (
    <TableNotice kind="whoStarts" tone="neutral" scale={scale}>
      <View style={[styles.row, { gap: part.rowGap }]}>
        {card?.suit ? (
          <NoticeTile rank={rank} suit={card.suit} />
        ) : (
          <NoticeDisc>{who.starterIsViewer ? t("gameShared.you") : who.starterName.slice(0, 1).toUpperCase()}</NoticeDisc>
        )}
        <View style={[styles.words, { gap: part.subGap }]}>
          <NoticeLine line="main">
            {runs.map((run, i) => (
              <Fragment key={i}>
                {i > 0 && <NoticeName>{who.starterName}</NoticeName>}
                {run}
              </Fragment>
            ))}
          </NoticeLine>
          {sub ? <NoticeLine line="sub">{sub}</NoticeLine> : null}
        </View>
      </View>
      {gated && <NoticeLine line="hint">{t("gameShared.startReasonDismiss")}</NoticeLine>}
    </TableNotice>
  );
}

/**
 * Who opens the manche, and why: one panel from the deal until the first play. While `gated` it
 * holds the table over a dimmed felt, releasing on its own reading budget or on one tap anywhere.
 */
export function WhoStartsPanel({
  gated,
  onDone,
  scale,
  tableLeft,
  tableRight,
  ...who
}: WhoStarts & {
  gated: boolean;
  /** Told once, when the gate opens — by the clock or by the player. */
  onDone: () => void;
  scale: number;
  tableLeft: number;
  tableRight: number;
}) {
  const { t } = useTranslation();
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  });
  useEffect(() => {
    if (!gated) return;
    const timer = setTimeout(() => doneRef.current(), Reading.notice);
    return () => clearTimeout(timer);
  }, [gated]);

  return (
    <>
      <A11yStatus label={whoStartsWords(t, who).spoken} role="alert" live="assertive" />
      {gated && (
        <Pressable
          testID="start-reason-gate"
          onPress={() => doneRef.current()}
          accessibilityLabel={t("gameShared.startReasonDismiss")}
          style={styles.gate}
          {...a11yHidden()}
        >
          <NoticeDim />
        </Pressable>
      )}
      <View pointerEvents="none" {...a11yHidden()} style={[styles.layer, { left: tableLeft, right: tableRight }]}>
        <WhoStartsCard gated={gated} scale={scale} {...who} />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  gate: { ...StyleSheet.absoluteFill, zIndex: GATE_Z },
  layer: {
    position: "absolute",
    top: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    zIndex: PANEL_Z,
  },
  row: { flexDirection: "row", alignItems: "center" },
  words: { flex: 1, minWidth: 0 },
});
