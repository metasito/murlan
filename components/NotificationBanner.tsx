import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, useWindowDimensions } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  cardScale,
  computeScreenPads,
  notificationTopOffset,
} from "@/components/gameTableModel";
import { Colors, Spacing, Radius, Type, Shadow, TOUCH_TARGET_MIN } from "@/lib/theme";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { useTranslation } from "@/lib/i18n";
import type { NotificationType, NotificationData } from "@/context/NotificationContext";
import { A11yStatus, a11yHidden, a11yVeiled, useA11yHint } from "@/lib/a11y";

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
  game_error: Colors.danger,
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
/**
 * Slack on the floor that ends a banner whose animation chain never reported
 * back. Under reduced motion every leg collapses to 0ms, so without it the
 * floor would land on the visible duration exactly — and it must never be the
 * thing that dismisses a banner that is behaving.
 */
const FLOOR_GRACE_MS = 1000;
// Clearance between whatever the banner sits under and the banner itself.
const TOP_GAP = 8;

export default function NotificationBanner({ notification, onDismiss }: Props) {
  const { t } = useTranslation();
  const dismissHint = useA11yHint(t("notificationBanner.dismissA11yHint"));
  const [pressed, setPressed] = useState(false);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const translateY = useSharedValue(-120);
  const opacity = useSharedValue(0);
  const reduceMotion = usePrefersReducedMotion();

  const { topPad } = computeScreenPads({ insets });
  const topOffset = notificationTopOffset({
    topPad,
    landscape: width > height,
    scale: cardScale(Math.min(width, height)),
  });
  // Reduced motion: keep the exact same callback chain (still a single,
  // sequential path to onDismiss) but collapse every leg to ~0ms so nothing
  // visibly slides.
  const slideDur = reduceMotion ? 0 : SLIDE_DURATION;

  // Must precede the effect that reads them — the React Compiler skips any component that mutates a value an effect captured.
  function handlePress() {
    translateY.value = withTiming(-120, { duration: slideDur });
    opacity.value = withTiming(0, { duration: slideDur * 0.75 }, (finished) => {
      if (finished) scheduleOnRN(onDismiss);
    });
    if (notification) notification.onPress?.();
  }

  useEffect(() => {
    if (notification) {
      const visibleDuration = notification.duration ?? DEFAULT_VISIBLE_DURATION;
      // Slide in first, then after visibleDuration auto-dismiss via callback chain
      translateY.value = withTiming(0, { duration: slideDur }, () => {
        translateY.value = withDelay(
          visibleDuration,
          withTiming(-120, { duration: slideDur }, (finished) => {
            if (finished) scheduleOnRN(onDismiss);
          })
        );
      });
      opacity.value = withTiming(1, { duration: slideDur }, () => {
        opacity.value = withDelay(
          visibleDuration + slideDur * 0.5,
          withTiming(0, { duration: slideDur })
        );
      });
      // The floor under that chain. Every leg hands on through a `finished`
      // callback, and `finished` is false for any interruption — so a chain
      // broken anywhere leaves the banner standing over the table for the rest
      // of the session. Late enough that it never cuts a healthy one short.
      const floor = setTimeout(onDismiss, visibleDuration + slideDur * 4 + FLOOR_GRACE_MS);
      return () => clearTimeout(floor);
    } else {
      // Instantly reset when dismissed programmatically
      translateY.value = withTiming(-120, { duration: slideDur });
      opacity.value = withTiming(0, { duration: slideDur });
    }
  }, [notification, opacity, slideDur, onDismiss, translateY]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  // Always render — animation controls visibility, never unmount
  const color = notification ? COLOR_MAP[notification.type] : Colors.gold;
  const icon = notification ? ICON_MAP[notification.type] : "notifications";
  const a11yLabel = notification
    ? `${notification.title}. ${notification.message}`
    : undefined;

  return (
    <Animated.View
      testID="notification-banner"
      style={[styles.container, { top: topOffset + TOP_GAP, pointerEvents: notification ? "box-none" as const : "none" as const }, animStyle]}
      // The banner never unmounts, so with nothing to announce its close button
      // is an invisible control a screen reader still finds. `pointerEvents`
      // answers for the pointer alone.
      {...a11yVeiled(!notification)}
    >
      <View style={[styles.banner, { borderLeftColor: color }, pressed && styles.bannerPressed]}>
        {/* The body's copy is a button's face and is hidden as one, so the
            region would have nothing left to announce. */}
        <A11yStatus label={a11yLabel ?? ""} veiled={!notification} role="alert" />
        <Pressable
          onPress={handlePress}
          onPressIn={() => setPressed(true)}
          onPressOut={() => setPressed(false)}
          style={styles.body}
          accessibilityRole="button"
          accessibilityLabel={a11yLabel}
          {...dismissHint.props}
        >
          {dismissHint.node}
          <View style={[styles.iconCircle, { backgroundColor: color + "22" }]} {...a11yHidden()}>
            <Ionicons name={icon} size={20} color={color} />
          </View>
          <View style={styles.textGroup} {...a11yHidden()}>
            <Text style={styles.title} numberOfLines={1}>{notification?.title ?? ""}</Text>
            <Text style={styles.message} numberOfLines={2}>{notification?.message ?? ""}</Text>
          </View>
        </Pressable>
        <Pressable
          onPress={handlePress}
          hitSlop={Spacing.md}
          style={styles.closeBtn}
          accessibilityRole="button"
          accessibilityLabel={t("notificationBanner.closeA11yLabel")}
        >
          <Ionicons name="close" size={20} color={Colors.textMuted} {...a11yHidden()} />
        </Pressable>
      </View>
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
    ...Shadow.overlay,
  },
  body: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm + 4,
  },
  bannerPressed: { backgroundColor: Colors.bgElevated },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: Radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  textGroup: {
    flex: 1,
    gap: Spacing.xxs,
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
    width: TOUCH_TARGET_MIN,
    height: TOUCH_TARGET_MIN,
    marginVertical: -Spacing.cosy,
    marginRight: -Spacing.sm,
    alignItems: "center",
    justifyContent: "center",
  },
});
