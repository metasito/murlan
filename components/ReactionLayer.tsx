// Emoji reactions for the online table.
//
// Split into three pieces because they render in three different places: the
// trigger belongs in the top bar, the picker floats under it, and the emojis
// themselves rise from the felt. The <GameTable> slots (`topBarExtra`,
// `overlays`) keep each one where it was.

import React, { useEffect } from "react";
import { Text, StyleSheet, Pressable } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withSequence,
  SlideInRight,
} from "react-native-reanimated";
import { Colors, FontSize, Motion, Radius, Scrim, Spacing } from "@/lib/theme";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { useTableReactions, type TableReaction } from "@/lib/reactions";
import { useTranslation } from "@/lib/i18n";

export const EMOJIS = ["😂", "🔥", "😤", "👏", "😱", "🤡", "💣", "👑"];

/** How long a reaction stays on screen as it rises. */
const RISE_MS = 1800;
const RISE_PX = -80;

function FloatingReaction({ reaction }: { reaction: TableReaction }) {
  const y = useSharedValue(0);
  const opacity = useSharedValue(1);
  const reduceMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (reduceMotion) {
      // Still fades out — otherwise it would never leave the screen.
      opacity.value = withTiming(0, { duration: RISE_MS });
      return;
    }
    y.value = withTiming(RISE_PX, { duration: RISE_MS });
    opacity.value = withSequence(
      withTiming(1, { duration: Motion.duration.base }),
      withTiming(0, { duration: RISE_MS - Motion.duration.base })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot mount animation; y/opacity are stable shared values, reduceMotion fixed per instance
  }, []);

  const aStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: y.value }],
    opacity: opacity.value,
  }));

  // Spread the seats across the felt so two reactions rarely overlap.
  const posMap = ["50%", "80%", "20%", "60%"];
  const left = posMap[reaction.fromSeat % posMap.length];

  return (
    <Animated.View style={[styles.floatingEmoji, { left: left as any }, aStyle]}>
      <Text style={styles.floatingEmojiText}>{reaction.emoji}</Text>
      <Text style={styles.floatingEmojiName}>{reaction.username}</Text>
    </Animated.View>
  );
}

/** Reads the reaction store itself, so a reaction re-renders this and nothing else. */
export function FloatingReactions() {
  const reactions = useTableReactions();
  return (
    <>
      {reactions.map((r) => (
        <FloatingReaction key={r.id} reaction={r} />
      ))}
    </>
  );
}

export function ReactionTrigger({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.trigger, pressed && styles.triggerPressed]}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={t("reactionLayer.triggerA11yLabel")}
    >
      <Text style={styles.triggerText}>💬</Text>
    </Pressable>
  );
}

export function ReactionPanel({
  onSelect,
  onClose,
  top,
}: {
  onSelect: (emoji: string) => void;
  onClose: () => void;
  /** Below the top bar it drops from — which the host is the one that knows. */
  top: number;
}) {
  const { t } = useTranslation();
  const reduceMotion = usePrefersReducedMotion();
  return (
    <Animated.View
      entering={reduceMotion ? undefined : SlideInRight.duration(Motion.duration.base)}
      style={[styles.panel, { top }]}
    >
      {EMOJIS.map((e) => (
        <Pressable
          key={e}
          onPress={() => {
            onSelect(e);
            onClose();
          }}
          style={({ pressed }) => [styles.emojiBtn, pressed && styles.emojiBtnPressed]}
          accessibilityRole="button"
          accessibilityLabel={t("reactionLayer.emojiA11yLabel", { emoji: e })}
        >
          <Text style={styles.emojiBtnText}>{e}</Text>
        </Pressable>
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  trigger: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Radius.sm,
  },
  triggerPressed: { backgroundColor: Colors.goldMuted },
  triggerText: { fontSize: FontSize.lg },

  panel: {
    position: "absolute",
    right: 12,
    backgroundColor: Colors.bgSurface,
    borderRadius: Radius.md + 4,
    borderWidth: 1,
    borderColor: Colors.border,
    flexDirection: "row",
    flexWrap: "wrap",
    padding: Spacing.sm,
    gap: Spacing.xs,
    width: 208,
    zIndex: 100,
  },
  emojiBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Radius.sm,
  },
  // Colour, not scale: the "glyph" here is text, and scaling it resamples it.
  emojiBtnPressed: { backgroundColor: Colors.goldMuted },
  emojiBtnText: { fontSize: FontSize.xl },

  floatingEmoji: {
    position: "absolute",
    bottom: "35%",
    alignItems: "center",
    zIndex: 200,
  },
  floatingEmojiText: { fontSize: FontSize.hero },
  floatingEmojiName: {
    fontFamily: "Inter_400Regular",
    fontSize: FontSize.xxs,
    color: Colors.textMuted,
    backgroundColor: Scrim.heavy,
    borderRadius: Radius.sm / 2,
    paddingHorizontal: Spacing.xs,
    paddingVertical: 1,
  },
});
