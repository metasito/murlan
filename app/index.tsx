import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
  ImageBackground,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withDelay,
  withRepeat,
  withSequence,
  Easing,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";

interface MenuButtonProps {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  onPress: () => void;
  delay?: number;
  accent?: boolean;
  disabled?: boolean;
}

function MenuButton({
  label,
  icon,
  onPress,
  delay = 0,
  accent = false,
  disabled = false,
}: MenuButtonProps) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(30);
  const scale = useSharedValue(1);

  useEffect(() => {
    opacity.value = withDelay(delay, withTiming(1, { duration: 500 }));
    translateY.value = withDelay(
      delay,
      withTiming(0, { duration: 500, easing: Easing.out(Easing.cubic) })
    );
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
  }));

  const handlePress = () => {
    if (disabled) return;
    scale.value = withSequence(
      withTiming(0.96, { duration: 80 }),
      withTiming(1, { duration: 120 })
    );
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };

  return (
    <Animated.View style={animStyle}>
      <Pressable
        onPress={handlePress}
        disabled={disabled}
        style={({ pressed }) => [
          styles.menuButton,
          accent && styles.menuButtonAccent,
          disabled && styles.menuButtonDisabled,
          pressed && { opacity: 0.85 },
        ]}
      >
        {accent ? (
          <LinearGradient
            colors={[Colors.gold, Colors.goldDark]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.accentGradient}
          >
            <Ionicons name={icon} size={20} color="#0A1F18" />
            <Text style={[styles.menuLabel, styles.menuLabelAccent]}>
              {label}
            </Text>
            <View style={{ width: 20 }} />
          </LinearGradient>
        ) : (
          <>
            <Ionicons
              name={icon}
              size={20}
              color={disabled ? Colors.textMuted : Colors.gold}
            />
            <Text
              style={[
                styles.menuLabel,
                disabled && { color: Colors.textMuted },
              ]}
            >
              {label}
            </Text>
            <Ionicons
              name="chevron-forward"
              size={16}
              color={disabled ? Colors.textMuted : Colors.textMuted}
            />
          </>
        )}
      </Pressable>
    </Animated.View>
  );
}

function FloatingCard({
  delay,
  x,
  size,
  opacity: baseOpacity,
}: {
  delay: number;
  x: number;
  size: number;
  opacity: number;
}) {
  const translateY = useSharedValue(0);
  const rotate = useSharedValue(0);

  useEffect(() => {
    translateY.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(-20, {
            duration: 3000 + Math.random() * 1000,
            easing: Easing.inOut(Easing.sin),
          }),
          withTiming(0, {
            duration: 3000 + Math.random() * 1000,
            easing: Easing.inOut(Easing.sin),
          })
        ),
        -1,
        false
      )
    );
    rotate.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(8, { duration: 4000, easing: Easing.inOut(Easing.sin) }),
          withTiming(-8, { duration: 4000, easing: Easing.inOut(Easing.sin) })
        ),
        -1,
        false
      )
    );
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: translateY.value },
      { rotate: `${rotate.value}deg` },
    ],
  }));

  return (
    <Animated.View
      style={[
        styles.floatingCard,
        {
          left: x,
          width: size,
          height: size * 1.45,
          opacity: baseOpacity,
        },
        animStyle,
      ]}
    >
      <LinearGradient
        colors={[Colors.feltLight, Colors.felt]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.floatingCardPattern} />
    </Animated.View>
  );
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const titleOpacity = useSharedValue(0);
  const titleScale = useSharedValue(0.85);
  const subtitleOpacity = useSharedValue(0);

  useEffect(() => {
    titleOpacity.value = withDelay(200, withTiming(1, { duration: 700 }));
    titleScale.value = withDelay(
      200,
      withTiming(1, { duration: 700, easing: Easing.out(Easing.back(1.5)) })
    );
    subtitleOpacity.value = withDelay(500, withTiming(1, { duration: 600 }));
  }, []);

  const titleStyle = useAnimatedStyle(() => ({
    opacity: titleOpacity.value,
    transform: [{ scale: titleScale.value }],
  }));
  const subtitleStyle = useAnimatedStyle(() => ({
    opacity: subtitleOpacity.value,
  }));

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  return (
    <View style={[styles.container, { paddingTop: topPad, paddingBottom: bottomPad + 20 }]}>
      <LinearGradient
        colors={[Colors.bg, Colors.bgCard, Colors.feltDark]}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
      />

      <FloatingCard delay={0} x={20} size={55} opacity={0.25} />
      <FloatingCard delay={800} x={120} size={42} opacity={0.18} />
      <FloatingCard delay={400} x={270} size={62} opacity={0.22} />
      <FloatingCard delay={1200} x={320} size={38} opacity={0.15} />

      <View style={styles.header}>
        <Animated.View style={titleStyle}>
          <Text style={styles.title}>MURLAN</Text>
          <View style={styles.titleUnderline}>
            <LinearGradient
              colors={[Colors.goldDark, Colors.gold, Colors.goldDark]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{ flex: 1, height: 2, borderRadius: 1 }}
            />
          </View>
        </Animated.View>
        <Animated.View style={subtitleStyle}>
          <Text style={styles.subtitle}>Il Gioco di Carte</Text>
        </Animated.View>
      </View>

      <View style={styles.cardDecoration}>
        {["♠", "♥", "♦", "♣"].map((suit, i) => (
          <Text
            key={suit}
            style={[
              styles.suitDecor,
              { color: i % 2 === 1 ? Colors.red : Colors.textMuted },
            ]}
          >
            {suit}
          </Text>
        ))}
      </View>

      <View style={styles.menu}>
        <MenuButton
          label="Gioca vs AI"
          icon="game-controller"
          accent
          onPress={() => router.push({ pathname: "/lobby", params: { mode: "ai" } })}
          delay={300}
        />
        <MenuButton
          label="Passa e Gioca"
          icon="people"
          onPress={() => router.push({ pathname: "/lobby", params: { mode: "local" } })}
          delay={420}
        />
        <MenuButton
          label="Online"
          icon="wifi"
          disabled
          onPress={() => {}}
          delay={540}
        />
        <MenuButton
          label="Regole & FAQ"
          icon="book-outline"
          onPress={() => router.push("/rules")}
          delay={660}
        />
      </View>

      <Animated.View style={[subtitleStyle, styles.footer]}>
        <Text style={styles.footerText}>2–4 giocatori · Tutte le modalità</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  header: {
    alignItems: "center",
    paddingTop: 40,
    paddingBottom: 12,
    gap: 6,
  },
  title: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 56,
    color: Colors.text,
    letterSpacing: 12,
    textAlign: "center",
  },
  titleUnderline: {
    width: 160,
    alignSelf: "center",
    marginTop: 4,
  },
  subtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: Colors.gold,
    letterSpacing: 4,
    textTransform: "uppercase",
    textAlign: "center",
    marginTop: 4,
  },
  cardDecoration: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 20,
    paddingVertical: 24,
  },
  suitDecor: {
    fontSize: 24,
    opacity: 0.7,
  },
  menu: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: "center",
    gap: 12,
  },
  menuButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.bgSurface,
    borderRadius: 14,
    paddingVertical: 18,
    paddingHorizontal: 20,
    gap: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  menuButtonAccent: {
    padding: 0,
    overflow: "hidden",
    borderColor: Colors.gold,
  },
  menuButtonDisabled: {
    borderColor: Colors.border,
    opacity: 0.5,
  },
  accentGradient: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 18,
    paddingHorizontal: 20,
    gap: 14,
  },
  menuLabel: {
    flex: 1,
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 18,
    color: Colors.text,
    letterSpacing: 0.5,
  },
  menuLabelAccent: {
    color: "#0A1F18",
    fontFamily: "Rajdhani_700Bold",
  },
  floatingCard: {
    position: "absolute",
    top: "12%",
    borderRadius: 8,
    overflow: "hidden",
    borderWidth: 1.5,
    borderColor: Colors.goldDark,
  },
  floatingCardPattern: {
    position: "absolute",
    top: 4,
    left: 4,
    right: 4,
    bottom: 4,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: "rgba(201,168,76,0.3)",
  },
  footer: {
    alignItems: "center",
    paddingTop: 20,
  },
  footerText: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: Colors.textMuted,
    letterSpacing: 1,
  },
});
