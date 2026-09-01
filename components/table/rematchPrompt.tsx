// The rematch question, put to the table down the side of the screen while the
// closing manche is still being played.
//
// Deliberately a side panel rather than a modal: it is asked while there is
// still a hand to play, so it must never take the table away from the player.
// Once answered it shrinks to the running tally.
import { View, StyleSheet, Pressable, type AccessibilityProps } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { TableText } from "./TableText";
import { a11yHidden } from "@/lib/a11y";
import { useTranslation } from "@/lib/i18n";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { hapticLight, hapticSelection } from "@/lib/haptics";
import {
  Colors,
  FontSize,
  Motion,
  Radius,
  Scrim,
  Spacing,
  TOUCH_TARGET_MIN,
  Type,
  Layer,
} from "@/lib/theme";

/** The rematch question's own column down the side of the table. */
const REMATCH_PANEL_W = 86;

/**
 * Majority decides; a seat that never answers counts as a no.
 *
 * Whether to ask at all is the table's business, not the panel's — so that
 * lives on `GameTableProps`'s slot and is not repeated here.
 */
export interface RematchAnswers {
  /** null until this player has answered. */
  myAnswer: boolean | null;
  yesCount: number;
  seatCount: number;
  onAnswer: (wants: boolean) => void;
}

export function RematchPromptPanel({
  prompt,
  top,
  left,
  veiled,
}: {
  prompt: RematchAnswers;
  top: number;
  left: number;
  veiled: AccessibilityProps;
}) {
  const { t } = useTranslation();
  const reduceMotion = usePrefersReducedMotion();
  const answered = prompt.myAnswer !== null;
  const tally = t("gameTable.rematchTally", {
    yes: prompt.yesCount,
    total: prompt.seatCount,
  });

  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeIn.duration(Motion.duration.travel)}
      style={[styles.rematchPanel, { top, left }]}
      {...veiled}
    >
      {answered ? (
        <TableText style={styles.rematchTally} accessibilityLiveRegion="polite">
          {tally}
        </TableText>
      ) : (
        <>
          <TableText style={styles.rematchTitle}>{t("gameTable.rematchPromptTitle")}</TableText>
          <TableText style={styles.rematchSubtitle}>{t("gameTable.rematchPromptSubtitle")}</TableText>
          <View style={styles.rematchButtons}>
            <Pressable
              testID="btn-rematch-yes"
              onPress={() => {
                hapticSelection();
                prompt.onAnswer(true);
              }}
              style={[styles.rematchChoice, styles.rematchChoiceYes]}
              accessibilityRole="button"
              accessibilityLabel={t("gameTable.rematchYesA11yLabel")}
            >
              <TableText style={styles.rematchChoiceYesLabel} {...a11yHidden()}>{t("gameTable.rematchYes")}</TableText>
            </Pressable>
            <Pressable
              testID="btn-rematch-no"
              onPress={() => {
                hapticLight();
                prompt.onAnswer(false);
              }}
              style={styles.rematchChoice}
              accessibilityRole="button"
              accessibilityLabel={t("gameTable.rematchNoA11yLabel")}
            >
              <TableText style={styles.rematchChoiceLabel} {...a11yHidden()}>{t("gameTable.rematchNo")}</TableText>
            </Pressable>
          </View>
          <TableText style={styles.rematchTally}>{tally}</TableText>
        </>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  rematchPanel: {
    position: "absolute",
    width: REMATCH_PANEL_W,
    zIndex: Layer.rail,
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.xs + 2,
    borderRadius: Radius.md,
    backgroundColor: Scrim.heavy,
    borderWidth: 1,
    borderColor: Colors.goldBorder,
    alignItems: "center",
  },
  rematchTitle: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.sm,
    color: Colors.gold,
    letterSpacing: 1,
  },
  rematchSubtitle: {
    ...Type.caption,
    fontSize: FontSize.xs - 2,
    textAlign: "center",
  },
  rematchButtons: { alignSelf: "stretch", gap: Spacing.xs },
  rematchChoice: {
    minHeight: TOUCH_TARGET_MIN,
    borderRadius: Radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.bgSurface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  rematchChoiceYes: {
    backgroundColor: Colors.goldMuted,
    borderColor: Colors.goldStrong,
  },
  rematchChoiceLabel: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    letterSpacing: 1,
  },
  rematchChoiceYesLabel: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.sm,
    color: Colors.goldLight,
    letterSpacing: 1,
  },
  rematchTally: {
    ...Type.caption,
    fontSize: FontSize.xs - 2,
  },
});
