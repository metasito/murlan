// The offline lobby and the online room's bot fill both let a host pick one
// of the same three opponents (#904) — this is that choice, in one place, so
// picking it never grows a second visual shape for the same three ids.
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { hapticSelection } from "@/lib/haptics";
import { BOT_PERSONALITIES, BotPersonalityId, difficultyLabelKey, getBotPersonality } from "@/lib/botPersonalities";
import type { AIDifficulty } from "@/lib/gameEngine";
import { Colors, Spacing, Radius, FontSize, TOUCH_TARGET_MIN } from "@/lib/theme";
import { useTranslation } from "@/lib/i18n";
import { a11yHidden, a11yState } from "@/lib/a11y";

// A local one-off rather than a Radius step: the bar is 3px wide, and every
// step on that scale (Radius.sm = 8) would round it into a pill.
const LADDER_BAR_RADIUS = 1;

/**
 * The rising-glyph reading has to come from bar height, not just which bars
 * are dimmed: a selected segment forces every bar fully opaque
 * (ladderBarSelected), so height is the only cue left standing once a tier
 * is picked.
 */
const TIER_BARS: Record<AIDifficulty, { height: number; dim?: boolean }[]> = {
  easy: [{ height: 4 }, { height: 4, dim: true }, { height: 4, dim: true }],
  medium: [{ height: 5 }, { height: 7 }, { height: 7, dim: true }],
  hard: [{ height: 5 }, { height: 7 }, { height: 10 }],
};

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
              {TIER_BARS[p.difficulty].map((bar, barIndex) => (
                <View
                  key={barIndex}
                  style={[
                    styles.ladderBar,
                    { height: bar.height, opacity: bar.dim ? 0.25 : 1 },
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
    borderTopWidth: 2,
    borderTopColor: "transparent",
  },
  ladderSegBorder: {
    borderLeftWidth: 1,
    borderLeftColor: Colors.border,
  },
  ladderSegSelected: {
    backgroundColor: Colors.gold,
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
