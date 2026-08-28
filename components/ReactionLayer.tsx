// Emoji reactions for the online table.
//
// Split into three pieces because they render in three different places: the
// trigger is the control rail's lower knob, the tray opens beside it, and the
// emojis themselves rise from the felt. The <GameTable> slots (`railExtra`,
// `overlays`) keep each one where it belongs.

import React, { useEffect } from "react";
import { Text, StyleSheet, Pressable } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withSequence,
  SlideInLeft,
} from "react-native-reanimated";
import { Colors, FontSize, Motion, Radius, Scrim, Spacing, TOUCH_TARGET_MIN } from "@/lib/theme";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { useTableReactions, type TableReaction } from "@/lib/reactions";
import { useTranslation } from "@/lib/i18n";
import { a11yHidden } from "@/lib/a11y";

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
  }, [opacity, reduceMotion, y]);

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
      <Text style={styles.triggerText} {...a11yHidden()}>💬</Text>
    </Pressable>
  );
}

export function ReactionPanel({
  onSelect,
  onClose,
  left,
  bottom,
}: {
  onSelect: (emoji: string) => void;
  onClose: () => void;
  /** Beside the rail's lower knob — the trigger this tray belongs to. */
  left: number;
  bottom: number;
}) {
  const { t } = useTranslation();
  const reduceMotion = usePrefersReducedMotion();
  return (
    <Animated.View
      entering={reduceMotion ? undefined : SlideInLeft.duration(Motion.duration.base)}
      style={[styles.panel, { left, bottom }]}
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
          <Text style={styles.emojiBtnText} {...a11yHidden()}>{e}</Text>
        </Pressable>
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  trigger: {
    width: TOUCH_TARGET_MIN,
    height: TOUCH_TARGET_MIN,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: TOUCH_TARGET_MIN / 2,
    backgroundColor: Scrim.heavy,
    borderWidth: 1,
    borderColor: Colors.goldBorder,
  },
  triggerPressed: { backgroundColor: Colors.goldMuted, borderColor: Colors.goldStrong },
  triggerText: { fontSize: FontSize.lg },

  panel: {
    position: "absolute",
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
    width: TOUCH_TARGET_MIN,
    height: TOUCH_TARGET_MIN,
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
    paddingVertical: Spacing.xxs,
  },
});
