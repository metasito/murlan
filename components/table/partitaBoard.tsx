import { Pressable, StyleSheet, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { LinearGradient } from "expo-linear-gradient";
import { TableText } from "./TableText";
import { Colors, FontSize, Gradient, TOUCH_TARGET_MIN, withAlpha } from "@/lib/theme";
import { useTranslation } from "@/lib/i18n";
import { a11yHidden, a11yState } from "@/lib/a11y";
import { tableFontSize } from "@/components/cardFaceModel";

// The end-of-partita board's own content, inside the score pill's board state: the mockup's
// `.bx` winner box and `.bt` actions (#1267).

export interface PartitaWinner {
  /** The winner, or every tied name on a draw. */
  name: string;
  mine: boolean;
  draw: boolean;
  line: string;
}

export interface PartitaBoardActions {
  onHome: () => void;
  /** Nuova partita; null where the table stops. Online it is the rematch vote, with its tally. */
  again: { onPress: () => void; testID: string; tally?: { votes: number; total: number; voted: boolean } } | null;
}

const PX = {
  box: 150,
  ring: 48,
  trophy: 24,
  ringBorder: 1.5,
  between: 6,
  ringBelow: 4,
  labelTracking: 2,
  nameTracking: 1,
  nameGlow: 14,
  btnH: 30,
  btnPadH: 16,
  btnGap: 10,
  btnTracking: 2,
};

export const BOARD_ACTIONS_AT = { x: 162, y: 206 };

export function partitaWinnerSpoken(winner: PartitaWinner, t: ReturnType<typeof useTranslation>["t"]): string {
  return [winnerLabel(winner, t), winner.name, winner.line].filter(Boolean).join(". ");
}

function winnerLabel(winner: PartitaWinner, t: ReturnType<typeof useTranslation>["t"]): string {
  if (!winner.name) return t("result.matchOverTitle");
  if (winner.draw) return t("result.matchDrawTitle");
  return winner.mine ? t("partitaBoard.youWon") : t("partitaBoard.wins");
}

export function PartitaWinnerBox({ winner, unit: u, height }: { winner: PartitaWinner; unit: number; height: number }) {
  const { t } = useTranslation();
  const label = tableFontSize(FontSize.xxs, u);
  return (
    <View {...a11yHidden()} testID="partita-winner" style={[styles.box, { width: PX.box * u, height, gap: PX.between * u }]}>
      <View
        style={[
          styles.ring,
          {
            width: PX.ring * u,
            height: PX.ring * u,
            borderRadius: (PX.ring * u) / 2,
            borderWidth: PX.ringBorder * u,
            marginBottom: PX.ringBelow * u,
          },
        ]}
      >
        <Ionicons name="trophy" size={PX.trophy * u} color={Colors.gold} />
      </View>
      <TableText style={[styles.label, { fontSize: label, letterSpacing: PX.labelTracking * u }]}>
        {winnerLabel(winner, t)}
      </TableText>
      {winner.name ? (
        <TableText
          testID="partita-winner-name"
          numberOfLines={1}
          style={[
            styles.name,
            winner.mine && [styles.nameMine, { textShadowRadius: PX.nameGlow * u }],
            { fontSize: tableFontSize(FontSize.xl, u), letterSpacing: PX.nameTracking * u },
          ]}
        >
          {winner.name}
        </TableText>
      ) : null}
      <TableText style={[styles.label, { fontSize: label, letterSpacing: PX.labelTracking * u }]}>{winner.line}</TableText>
    </View>
  );
}

export function PartitaBoardButtons({ actions, unit: u, live }: { actions: PartitaBoardActions; unit: number; live: boolean }) {
  const { t } = useTranslation();
  const tally = actions.again?.tally;
  const waiting = tally?.voted
    ? t("gameOverOverlay.nextHandWaiting", { count: tally.votes, total: tally.total })
    : null;
  return (
    <View style={[styles.actions, { gap: PX.btnGap * u }]} pointerEvents={live ? "box-none" : "none"}>
      <BoardButton testID="btn-home" label={t("result.home")} onPress={actions.onHome} unit={u} live={live} />
      {actions.again ? (
        <BoardButton
          primary
          testID={actions.again.testID}
          label={waiting ?? t("result.newMatch")}
          a11yLabel={
            tally?.voted
              ? t("gameOverOverlay.waitingA11yLabel", { count: tally.votes, total: tally.total })
              : t("gameOverOverlay.newMatchA11yLabel")
          }
          disabled={tally?.voted}
          onPress={actions.again.onPress}
          unit={u}
          live={live}
        />
      ) : (
        <TableText style={[styles.label, { fontSize: tableFontSize(FontSize.xxs, u), letterSpacing: PX.labelTracking * u }]}>
          {t("result.tableStops")}
        </TableText>
      )}
    </View>
  );
}

function BoardButton({
  label,
  a11yLabel,
  testID,
  onPress,
  primary = false,
  disabled = false,
  live,
  unit: u,
}: {
  label: string;
  a11yLabel?: string;
  testID: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
  live: boolean;
  unit: number;
}) {
  const h = PX.btnH * u;
  const slop = Math.max(0, (TOUCH_TARGET_MIN - h) / 2);
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled || !live}
      hitSlop={{ top: slop, bottom: slop }}
      accessibilityLabel={a11yLabel ?? label}
      {...a11yState({ role: "button", disabled: disabled || !live })}
      style={[styles.btn, primary && styles.btnPrimary, { height: h, borderRadius: h / 2, paddingHorizontal: PX.btnPadH * u }]}
    >
      {primary && (
        <LinearGradient colors={Gradient.playButton} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      )}
      <TableText
        {...a11yHidden()}
        style={[
          styles.btnText,
          primary && styles.btnTextPrimary,
          { fontSize: tableFontSize(FontSize.xs, u), letterSpacing: PX.btnTracking * u },
        ]}
      >
        {label}
      </TableText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    position: "absolute",
    left: 0,
    top: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: Colors.goldMuted,
  },
  ring: { alignItems: "center", justifyContent: "center", borderColor: Colors.gold, backgroundColor: Colors.goldMuted },
  label: { fontFamily: "Rajdhani_600SemiBold", color: Colors.textMuted, textTransform: "uppercase", textAlign: "center" },
  name: { fontFamily: "Rajdhani_700Bold", color: Colors.text, textTransform: "uppercase", textAlign: "center" },
  nameMine: { color: Colors.goldLit, textShadowColor: withAlpha(Colors.goldLit, 0.5) },
  actions: { flexDirection: "row", alignItems: "center" },
  btn: {
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.goldStrong,
    backgroundColor: withAlpha(Colors.bg, 0.8),
  },
  btnPrimary: { borderColor: Colors.goldLit },
  btnText: { fontFamily: "Rajdhani_700Bold", color: Colors.text, textTransform: "uppercase" },
  btnTextPrimary: { color: Colors.badgeInk },
});
