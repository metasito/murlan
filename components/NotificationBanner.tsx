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
import { Colors } from '@/lib/theme';
import { Shadow } from "@/lib/theme";
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
  afk: "#E0A830",
  connection: Colors.success,
};

const SLIDE_DURATION = 320;
const DEFAULT_VISIBLE_DURATION = 4500;

export default function NotificationBanner({ notification, onDismiss }: Props) {
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(-120);
  const opacity = useSharedValue(0);

  const topOffset = Platform.OS === "web" ? 67 : insets.top;

  useEffect(() => {
    if (notification) {
      const visibleDuration = notification.duration ?? DEFAULT_VISIBLE_DURATION;
      // Slide in first, then after visibleDuration auto-dismiss via callback chain
      translateY.value = withTiming(0, { duration: SLIDE_DURATION }, () => {
        translateY.value = withDelay(
          visibleDuration,
          withTiming(-120, { duration: SLIDE_DURATION }, (finished) => {
            if (finished) runOnJS(onDismiss)();
          })
        );
      });
      opacity.value = withTiming(1, { duration: SLIDE_DURATION }, () => {
        opacity.value = withDelay(
          visibleDuration + SLIDE_DURATION * 0.5,
          withTiming(0, { duration: SLIDE_DURATION })
        );
      });
    } else {
      // Instantly reset when dismissed programmatically
      translateY.value = withTiming(-120, { duration: SLIDE_DURATION });
      opacity.value = withTiming(0, { duration: SLIDE_DURATION });
    }
  }, [notification]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  function handlePress() {
    translateY.value = withTiming(-120, { duration: SLIDE_DURATION });
    opacity.value = withTiming(0, { duration: SLIDE_DURATION * 0.75 }, (finished) => {
      if (finished) runOnJS(onDismiss)();
    });
    if (notification) notification.onPress?.();
  }

  // Always render — animation controls visibility, never unmount
  const color = notification ? COLOR_MAP[notification.type] : Colors.gold;
  const icon = notification ? ICON_MAP[notification.type] : "notifications";

  return (
    <Animated.View
      style={[styles.container, { top: topOffset + 8, pointerEvents: notification ? "box-none" as const : "none" as const }, animStyle]}
    >
      <Pressable onPress={handlePress} style={[styles.banner, { borderLeftColor: color }]}>
        <View style={[styles.iconCircle, { backgroundColor: color + "22" }]}>
          <Ionicons name={icon} size={20} color={color} />
        </View>
        <View style={styles.textGroup}>
          <Text style={styles.title}>{notification?.title ?? ""}</Text>
          <Text style={styles.message} numberOfLines={2}>{notification?.message ?? ""}</Text>
        </View>
        <Pressable onPress={handlePress} hitSlop={16} style={styles.closeBtn}>
          <Ionicons name="close" size={20} color={Colors.textMuted} />
        </Pressable>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 12,
    right: 12,
    zIndex: 9999,
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.bgSurface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    borderLeftWidth: 4,
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 12,
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
    fontFamily: "Rajdhani_700Bold",
    fontSize: 15,
    color: Colors.text,
    letterSpacing: 0.3,
  },
  message: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: Colors.textMuted,
    lineHeight: 17,
  },
  closeBtn: {
    padding: 4,
  },
});
