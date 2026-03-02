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
import Colors from "@/constants/colors";

export type NotificationType = "friend_request" | "friend_accepted" | "game_invite";

export interface NotificationData {
  type: NotificationType;
  title: string;
  message: string;
  onPress?: () => void;
}

interface Props {
  notification: NotificationData | null;
  onDismiss: () => void;
}

const ICON_MAP: Record<NotificationType, React.ComponentProps<typeof Ionicons>["name"]> = {
  friend_request: "person-add",
  friend_accepted: "people",
  game_invite: "game-controller",
};

const COLOR_MAP: Record<NotificationType, string> = {
  friend_request: Colors.gold,
  friend_accepted: "#4CAF50",
  game_invite: "#6b8ef5",
};

const SLIDE_DURATION = 320;
const VISIBLE_DURATION = 4000;

export default function NotificationBanner({ notification, onDismiss }: Props) {
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(-120);
  const opacity = useSharedValue(0);

  const topOffset = Platform.OS === "web" ? 67 : insets.top;

  useEffect(() => {
    if (notification) {
      // Slide in first, then after VISIBLE_DURATION auto-dismiss
      translateY.value = withTiming(0, { duration: SLIDE_DURATION }, () => {
        translateY.value = withDelay(
          VISIBLE_DURATION,
          withTiming(-120, { duration: SLIDE_DURATION }, (finished) => {
            if (finished) runOnJS(onDismiss)();
          })
        );
      });
      opacity.value = withTiming(1, { duration: SLIDE_DURATION }, () => {
        opacity.value = withDelay(
          VISIBLE_DURATION + SLIDE_DURATION * 0.5,
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
      style={[styles.container, { top: topOffset + 8 }, animStyle]}
      pointerEvents={notification ? "box-none" : "none"}
    >
      <Pressable onPress={handlePress} style={[styles.banner, { borderLeftColor: color }]}>
        <View style={[styles.iconCircle, { backgroundColor: color + "22" }]}>
          <Ionicons name={icon} size={20} color={color} />
        </View>
        <View style={styles.textGroup}>
          <Text style={styles.title}>{notification?.title ?? ""}</Text>
          <Text style={styles.message} numberOfLines={1}>{notification?.message ?? ""}</Text>
        </View>
        <Pressable onPress={handlePress} hitSlop={8} style={styles.closeBtn}>
          <Ionicons name="close" size={16} color={Colors.textMuted} />
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
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
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
  },
  closeBtn: {
    padding: 4,
  },
});
