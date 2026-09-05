// The offline lobby and the online room's bot fill both let a host pick one
// of the same three opponents (#904) — this is that choice, in one place, so
// picking it never grows a second visual shape for the same three ids.
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { hapticSelection } from "@/lib/haptics";
import { BOT_PERSONALITIES, BotPersonalityId, difficultyLabelKey, getBotPersonality } from "@/lib/botPersonalities";
import { Colors, Spacing, Radius, FontSize, TOUCH_TARGET_MIN } from "@/lib/theme";
import { useTranslation } from "@/lib/i18n";
import { a11yHidden, a11yState } from "@/lib/a11y";

// A local one-off rather than a Radius step: the bar is 3px wide, and every
// step on that scale (Radius.sm = 8) would round it into a pill.
const LADDER_BAR_RADIUS = 1;

export function DifficultyLadder({
  personality,
  onChange,
  a11yName,
}: {
  personality: string | undefined;
  onChange: (id: BotPersonalityId) => void;
  /** What the segment belongs to, e.g. a seat's name — read as part of each segment's label. */
  a11yName: string;
}) {
  const { t } = useTranslation();
  const current = getBotPersonality(personality);

  return (
    <View style={styles.ladder}>
      {BOT_PERSONALITIES.map((p, i) => {
        const selected = p.id === current.id;
        return (
          <Pressable
            key={p.id}
            onPress={() => { onChange(p.id); hapticSelection(); }}
            style={[
              styles.ladderSeg,
              i > 0 && styles.ladderSegBorder,
              selected && styles.ladderSegSelected,
            ]}
            accessibilityLabel={t("lobby.difficultyA11yLabel", {
              name: a11yName,
              difficulty: t(difficultyLabelKey(p.difficulty)),
            })}
            {...a11yState({ role: "radio", selected })}
          >
            <View {...a11yHidden()} style={styles.ladderBars}>
              {[0, 1, 2].map((bar) => (
                <View
                  key={bar}
                  style={[
                    styles.ladderBar,
                    { height: 4 + bar * 3, opacity: bar <= i ? 1 : 0.25 },
                    selected && styles.ladderBarSelected,
                  ]}
                />
              ))}
            </View>
            <Text
              {...a11yHidden()}
              style={[styles.ladderSegText, selected && styles.ladderSegTextSelected]}
            >
              {t(difficultyLabelKey(p.difficulty))}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  ladder: {
    flexDirection: "row",
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.bgElevated,
    overflow: "hidden",
  },
  ladderSeg: {
    flex: 1,
    minHeight: TOUCH_TARGET_MIN,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xxs,
    paddingVertical: Spacing.slim,
  },
  ladderSegBorder: {
    borderLeftWidth: 1,
    borderLeftColor: Colors.border,
  },
  ladderSegSelected: {
    backgroundColor: Colors.gold,
    borderTopWidth: 2,
    borderTopColor: Colors.goldLight,
  },
  ladderBars: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: Spacing.xxs,
    height: 10,
  },
  ladderBar: {
    width: 3,
    borderRadius: LADDER_BAR_RADIUS,
    backgroundColor: Colors.textMuted,
  },
  ladderBarSelected: {
    backgroundColor: Colors.bgCard,
    opacity: 1,
  },
  ladderSegText: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
  },
  ladderSegTextSelected: {
    color: Colors.bgCard,
  },
});
