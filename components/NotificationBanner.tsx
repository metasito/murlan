import React, { useEffect } from "react";
import { View, Text, StyleSheet, Pressable, Platform } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  runOnJS,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors, Spacing, Radius, Type, Shadow } from "@/lib/theme";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import type { NotificationType, NotificationData } from "@/context/NotificationContext";

export type { NotificationType, NotificationData };

interface Props {
  notification: NotificationData | null;
  onDismiss: () => void;
}

const ICON_MAP: Record<NotificationType, React.ComponentProps<typeof Ionicons>["name"]> = {
  friend_request: "person-add",
  friend_accepted: "people",
  game_invite: "game-controller",
  game_info: "information-circle",
  game_error: "alert-circle",
  afk: "timer-outline",
  connection: "wifi",
};

const COLOR_MAP: Record<NotificationType, string> = {
  friend_request: Colors.gold,
  friend_accepted: Colors.success,
  game_invite: Colors.info,
  game_info: Colors.textSecondary,
  game_error: Colors.red,
  afk: Colors.gold,
  connection: Colors.success,
};

// Pinned by an app invariant (see CLAUDE.md / ExchangeAnnouncement neighbours):
// slide-in 320ms → wait ~4s → slide-out, always as a single callback chain,
// never as parallel withTiming calls (a second assignment would clobber the
// slide-in before it finishes). Not a lib/theme.ts Motion value because no
// entry there matches 320ms and this exact number is the contract, not a
// generic transition duration.
const SLIDE_DURATION = 320;
const DEFAULT_VISIBLE_DURATION = 4500;

export default function NotificationBanner({ notification, onDismiss }: Props) {
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(-120);
  const opacity = useSharedValue(0);
  const reduceMotion = usePrefersReducedMotion();

  const topOffset = Platform.OS === "web" ? 67 : insets.top;
  // Reduced motion: keep the exact same callback chain (still a single,
  // sequential path to onDismiss) but collapse every leg to ~0ms so nothing
  // visibly slides.
  const slideDur = reduceMotion ? 0 : SLIDE_DURATION;

  useEffect(() => {
    if (notification) {
      const visibleDuration = notification.duration ?? DEFAULT_VISIBLE_DURATION;
      // Slide in first, then after visibleDuration auto-dismiss via callback chain
      translateY.value = withTiming(0, { duration: slideDur }, () => {
        translateY.value = withDelay(
          visibleDuration,
          withTiming(-120, { duration: slideDur }, (finished) => {
            if (finished) runOnJS(onDismiss)();
          })
        );
      });
      opacity.value = withTiming(1, { duration: slideDur }, () => {
        opacity.value = withDelay(
          visibleDuration + slideDur * 0.5,
          withTiming(0, { duration: slideDur })
        );
      });
    } else {
      // Instantly reset when dismissed programmatically
      translateY.value = withTiming(-120, { duration: slideDur });
      opacity.value = withTiming(0, { duration: slideDur });
    }
  }, [notification, slideDur]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  function handlePress() {
    translateY.value = withTiming(-120, { duration: slideDur });
    opacity.value = withTiming(0, { duration: slideDur * 0.75 }, (finished) => {
      if (finished) runOnJS(onDismiss)();
    });
    if (notification) notification.onPress?.();
  }

  // Always render — animation controls visibility, never unmount
  const color = notification ? COLOR_MAP[notification.type] : Colors.gold;
  const icon = notification ? ICON_MAP[notification.type] : "notifications";
  const a11yLabel = notification
    ? `${notification.title}. ${notification.message}`
    : undefined;

  return (
    <Animated.View
      style={[styles.container, { top: topOffset + 8, pointerEvents: notification ? "box-none" as const : "none" as const }, animStyle]}
    >
      <Pressable
        onPress={handlePress}
        style={[styles.banner, { borderLeftColor: color }]}
        accessibilityRole="alert"
        accessibilityLiveRegion={notification ? "polite" : "none"}
        accessibilityLabel={a11yLabel}
        accessibilityHint="Tocca per chiudere la notifica"
      >
        <View style={[styles.iconCircle, { backgroundColor: color + "22" }]}>
          <Ionicons name={icon} size={20} color={color} />
        </View>
        <View style={styles.textGroup}>
          <Text style={styles.title}>{notification?.title ?? ""}</Text>
          <Text style={styles.message} numberOfLines={2}>{notification?.message ?? ""}</Text>
        </View>
        <Pressable
          onPress={handlePress}
          hitSlop={Spacing.md}
          style={styles.closeBtn}
          accessibilityRole="button"
          accessibilityLabel="Chiudi notifica"
        >
          <Ionicons name="close" size={20} color={Colors.textMuted} />
        </Pressable>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: Spacing.sm + 4,
    right: Spacing.sm + 4,
    zIndex: 9999,
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.bgSurface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    borderLeftWidth: 4,
    paddingVertical: Spacing.sm + 4,
    paddingHorizontal: Spacing.md - 2,
    gap: Spacing.sm + 4,
    ...Shadow.dark,
  },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  textGroup: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...Type.subheading,
    color: Colors.text,
    letterSpacing: 0.3,
  },
  message: {
    ...Type.caption,
    lineHeight: 16,
  },
  closeBtn: {
    width: 44,
    height: 44,
    marginVertical: -12,
    marginRight: -8,
    alignItems: "center",
    justifyContent: "center",
  },
});
