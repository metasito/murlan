import React, { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
  useWindowDimensions,
  ScrollView,
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
import { hapticLight } from "@/lib/haptics";
import Feather from "@expo/vector-icons/Feather";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { useGame } from "@/context/GameContext";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { Colors, FontSize, Radius, TOUCH_TARGET_MIN, WEB_BOTTOM_PAD, WEB_TOP_PAD } from '@/lib/theme';
import { useTranslation } from "@/lib/i18n";
import { SettingsModal } from "@/components/SettingsModal";
import { a11yState } from "@/lib/a11y";

/**
 * A destination on the home screen: an icon, a label, and a chevron, animated
 * in on a stagger.
 *
 * Deliberately not components/MenuButton.tsx, which twelve other screens use —
 * that is a pill-shaped CTA with variants and sizes, and this is a row in a
 * list. The names must stay apart: the shared component clips its gradient and
 * has no padding conflict, so reading it tells you nothing about this one.
 */
interface HomeMenuRowProps {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  onPress: () => void;
  delay?: number;
  accent?: boolean;
  disabled?: boolean;
  compact?: boolean;
  accessibilityLabel?: string;
}

function HomeMenuRow({
  label,
  icon,
  onPress,
  delay = 0,
  accent = false,
  disabled = false,
  compact = false,
  accessibilityLabel,
}: HomeMenuRowProps) {
  const reduceMotion = usePrefersReducedMotion();
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(30);
  const scale = useSharedValue(1);

  useEffect(() => {
    if (reduceMotion) {
      opacity.value = 1;
      translateY.value = 0;
      return;
    }
    opacity.value = withDelay(delay, withTiming(1, { duration: 500 }));
    translateY.value = withDelay(
      delay,
      withTiming(0, { duration: 500, easing: Easing.out(Easing.cubic) })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot mount animation; opacity/translateY are stable shared values, delay is fixed per instance
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
  }));

  const handlePress = () => {
    if (disabled) return;
    if (!reduceMotion) {
      scale.value = withSequence(
        withTiming(0.96, { duration: 80 }),
        withTiming(1, { duration: 120 })
      );
    }
    hapticLight();
    onPress();
  };

  return (
    <Animated.View style={animStyle}>
      <Pressable
        onPress={handlePress}
        disabled={disabled}
        accessibilityLabel={accessibilityLabel ?? label}
        {...a11yState({ role: "button", disabled })}
        style={({ pressed }) => [
          styles.menuButton,
          compact && styles.menuButtonCompact,
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
            style={compact ? styles.accentGradientCompact : styles.accentGradient}
          >
            <Ionicons name={icon} size={compact ? 18 : 20} color={Colors.bgCard} />
            <Text style={[styles.menuLabel, styles.menuLabelAccent, compact && styles.menuLabelCompact]}>
              {label}
            </Text>
            <View style={{ width: compact ? 18 : 20 }} />
          </LinearGradient>
        ) : (
          <>
            <Ionicons
              name={icon}
              size={compact ? 18 : 20}
              color={disabled ? Colors.textMuted : Colors.gold}
            />
            <Text
              style={[
                styles.menuLabel,
                compact && styles.menuLabelCompact,
                disabled && { color: Colors.textMuted },
              ]}
            >
              {label}
            </Text>
            <Ionicons
              name="chevron-forward"
              size={compact ? 14 : 16}
              color={Colors.textMuted}
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
  const reduceMotion = usePrefersReducedMotion();
  const translateY = useSharedValue(0);
  const rotate = useSharedValue(0);

  useEffect(() => {
    // Decorative drift with no end. Under reduced motion the cards simply sit
    // where they were placed — there is nothing here to convey, only mood.
    if (reduceMotion) return;
    translateY.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(-20, { duration: 3000 + Math.random() * 1000, easing: Easing.inOut(Easing.sin) }),
          withTiming(0, { duration: 3000 + Math.random() * 1000, easing: Easing.inOut(Easing.sin) })
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot mount animation; rotate/translateY are stable shared values, delay is fixed per instance
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }, { rotate: `${rotate.value}deg` }],
  }));

  return (
    <Animated.View
      style={[
        styles.floatingCard,
        { left: x, width: size, height: size * 1.45, opacity: baseOpacity },
        animStyle,
      ]}
    >
      <LinearGradient colors={[Colors.feltLight, Colors.felt]} style={StyleSheet.absoluteFill} />
      <View style={styles.floatingCardPattern} />
    </Animated.View>
  );
}

function FriendsButton({ compact }: { compact?: boolean }) {
  const { user } = useAuth();
  const { t } = useTranslation();

  const { data: requests = [] } = useQuery<{ id: string }[]>({
    queryKey: ["/api/friends/requests"],
    enabled: !!user,
    staleTime: 15000,
    refetchOnWindowFocus: true,
  });

  const badgeCount = requests.length;

  function handlePress() {
    hapticLight();
    if (user) {
      router.push("/(online)/friends");
    } else {
      router.push("/auth");
    }
  }

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [styles.friendsBtn, compact && styles.friendsBtnCompact, pressed && { opacity: 0.8 }]}
      hitSlop={4}
    >
      <Ionicons name="people" size={compact ? 16 : 20} color={compact ? Colors.gold : Colors.bgCard} />
      {!compact && <Text style={styles.friendsBtnText}>{t("home.friendsLabel")}</Text>}
      {badgeCount > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badgeCount > 9 ? "9+" : String(badgeCount)}</Text>
        </View>
      )}
    </Pressable>
  );
}

function SettingsButton({ compact, onPress }: { compact?: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t("home.settingsA11yLabel")}
      style={({ pressed }) => [styles.settingsBtn, pressed && { opacity: 0.8 }]}
      hitSlop={8}
    >
      <Feather name="settings" size={compact ? 16 : 18} color={Colors.gold} />
    </Pressable>
  );
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const { hasSavedGame, resumeGame } = useGame();
  const { t } = useTranslation();
  const { width: W, height: H } = useWindowDimensions();
  const isLandscape = W > H;
  const [settingsVisible, setSettingsVisible] = useState(false);

  const reduceMotion = usePrefersReducedMotion();
  const titleOpacity = useSharedValue(0);
  const titleScale = useSharedValue(0.85);
  const subtitleOpacity = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      titleOpacity.value = 1;
      titleScale.value = 1;
      subtitleOpacity.value = 1;
      return;
    }
    titleOpacity.value = withDelay(200, withTiming(1, { duration: 700 }));
    titleScale.value = withDelay(200, withTiming(1, { duration: 700, easing: Easing.out(Easing.back(1.5)) }));
    subtitleOpacity.value = withDelay(500, withTiming(1, { duration: 600 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot mount animation; stable shared values
  }, []);

  // First-launch onboarding: offer the interactive tutorial automatically, once
  // ever. This runs on every mount of the title screen, and every
  // `router.replace("/")` in the app remounts it, so "once" has to come from
  // the flag alone: app/tutorial.tsx writes it when the screen opens, not when
  // it is completed. Never gates play — the player can leave by any route.
  useEffect(() => {
    AsyncStorage.getItem("@murlan_tutorial_seen").then((seen) => {
      if (!seen) router.push("/tutorial");
    });
  }, []);

  const titleStyle = useAnimatedStyle(() => ({
    opacity: titleOpacity.value,
    transform: [{ scale: titleScale.value }],
  }));
  const subtitleStyle = useAnimatedStyle(() => ({
    opacity: subtitleOpacity.value,
  }));

  const topPad = Platform.OS === "web" ? WEB_TOP_PAD : insets.top;
  const bottomPad = Platform.OS === "web" ? WEB_BOTTOM_PAD : insets.bottom;
  const leftPad = isLandscape ? (Platform.OS === "web" ? 0 : insets.left) : 0;
  const rightPad = isLandscape ? (Platform.OS === "web" ? 0 : insets.right) : 0;

  // Resuming restores the context first; the table renders from what it finds.
  const onResume = () => {
    if (resumeGame()) router.push("/game");
  };

  const menuButtons = (compact: boolean) => (
    <>
      {hasSavedGame && (
        <HomeMenuRow compact={compact} label={t("home.resumeGame")} icon="play-circle" accent onPress={onResume} delay={240} />
      )}
      <HomeMenuRow compact={compact} label={t("home.modeOffline")} icon="game-controller" accent={!hasSavedGame} onPress={() => router.push({ pathname: "/lobby", params: { mode: "ai" } })} delay={300} />
      <HomeMenuRow compact={compact} label={t("home.modePlayWithFriends")} icon="people" onPress={() => { if (user) router.push("/(online)"); else router.push("/auth"); }} delay={420} />
      <HomeMenuRow compact={compact} label={t("home.modeOnline")} icon="earth-outline" onPress={() => { if (user) router.push("/(online)/quickmatch"); else router.push("/auth"); }} delay={540} />
      <HomeMenuRow compact={compact} label={t("home.modeProfile")} icon="stats-chart-outline" onPress={() => { if (user) router.push("/(online)/profile"); else router.push("/auth"); }} delay={580} />
      <HomeMenuRow compact={compact} label={t("home.modeTutorial")} icon="school-outline" onPress={() => router.push("/tutorial")} delay={600} />
      <HomeMenuRow compact={compact} label={t("home.modeRules")} icon="book-outline" onPress={() => router.push("/rules")} delay={660} />
    </>
  );

  if (isLandscape) {
    return (
      <View style={[styles.container, { paddingTop: topPad, paddingBottom: bottomPad, paddingLeft: leftPad, paddingRight: rightPad }]}>
        <LinearGradient colors={[Colors.bg, Colors.bgCard, Colors.feltDark]} locations={[0, 0.5, 1]} style={StyleSheet.absoluteFill} />
        <FloatingCard delay={0} x={20} size={40} opacity={0.2} />
        <FloatingCard delay={800} x={90} size={32} opacity={0.15} />

        <View style={styles.landscapeRow}>
          <View style={styles.landscapeLeft}>
            <Animated.View style={[titleStyle, { alignItems: "center" }]}>
              <Text style={styles.titleLandscape}>MURLAN</Text>
              <View style={styles.titleUnderlineLandscape}>
                <LinearGradient colors={[Colors.goldDark, Colors.gold, Colors.goldDark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flex: 1, height: 2, borderRadius: Radius.sm }} />
              </View>
            </Animated.View>
            <Animated.View style={subtitleStyle}>
              <Text style={styles.subtitleLandscape}>{t("home.subtitle")}</Text>
            </Animated.View>
            <View style={styles.cardDecorationLandscape}>
              {["♠", "♥", "♦", "♣"].map((suit, i) => (
                <Text key={suit} style={[styles.suitDecorSmall, { color: i % 2 === 1 ? Colors.red : Colors.textMuted }]}>{suit}</Text>
              ))}
            </View>
            {user && (
              <Animated.View style={[subtitleStyle, styles.userRowLandscape]}>
                <Ionicons name="person-circle-outline" size={13} color={Colors.gold} />
                <Text style={styles.userTextSmall} numberOfLines={1}>{user.username}</Text>
                <Pressable onPress={logout} style={styles.logoutBtn}>
                  <Text style={styles.logoutText}>{t("home.logout")}</Text>
                </Pressable>
                <FriendsButton compact />
                <SettingsButton compact onPress={() => setSettingsVisible(true)} />
              </Animated.View>
            )}
            {!user && (
              <View style={styles.userRowLandscape}>
                <SettingsButton compact onPress={() => setSettingsVisible(true)} />
              </View>
            )}
          </View>

          <ScrollView style={styles.landscapeRight} contentContainerStyle={styles.landscapeMenuContent} showsVerticalScrollIndicator={false}>
            {menuButtons(true)}
            <Animated.View style={subtitleStyle}>
              <Text style={[styles.footerText, { textAlign: "center", marginTop: 8 }]}>
                {t("home.footer")}
              </Text>
            </Animated.View>
          </ScrollView>
        </View>
        <SettingsModal visible={settingsVisible} onClose={() => setSettingsVisible(false)} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: topPad, paddingBottom: bottomPad + 20 }]}>
      <LinearGradient colors={[Colors.bg, Colors.bgCard, Colors.feltDark]} locations={[0, 0.5, 1]} style={StyleSheet.absoluteFill} />

      <FloatingCard delay={0} x={20} size={55} opacity={0.25} />
      <FloatingCard delay={800} x={120} size={42} opacity={0.18} />
      <FloatingCard delay={400} x={270} size={62} opacity={0.22} />
      <FloatingCard delay={1200} x={320} size={38} opacity={0.15} />

      <View style={styles.header}>
        <Animated.View style={[titleStyle, { alignItems: "center" }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Text style={styles.title}>MURLAN</Text>
            {__DEV__ && (
              <View style={styles.devBadge}>
                <Text style={styles.devBadgeText}>DEV</Text>
              </View>
            )}
          </View>
          <View style={styles.titleUnderline}>
            <LinearGradient colors={[Colors.goldDark, Colors.gold, Colors.goldDark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flex: 1, height: 2, borderRadius: Radius.sm }} />
          </View>
        </Animated.View>
        <Animated.View style={subtitleStyle}>
          <Text style={styles.subtitle}>{t("home.subtitle")}</Text>
        </Animated.View>
      </View>

      {user && (
        <Animated.View style={[subtitleStyle, styles.userRow]}>
          <Ionicons name="person-circle-outline" size={15} color={Colors.gold} />
          <Text style={styles.userText}>{user.username}</Text>
          <Pressable onPress={logout} style={styles.logoutBtn}>
            <Text style={styles.logoutText}>{t("home.logout")}</Text>
          </Pressable>
          <FriendsButton />
          <SettingsButton onPress={() => setSettingsVisible(true)} />
        </Animated.View>
      )}
      {!user && (
        <Animated.View style={[subtitleStyle, styles.userRow, { justifyContent: "center" }]}>
          <SettingsButton onPress={() => setSettingsVisible(true)} />
        </Animated.View>
      )}

      <View style={styles.cardDecoration}>
        {["♠", "♥", "♦", "♣"].map((suit, i) => (
          <Text key={suit} style={[styles.suitDecor, { color: i % 2 === 1 ? Colors.red : Colors.textMuted }]}>{suit}</Text>
        ))}
      </View>

      <ScrollView
        style={styles.menuScroll}
        contentContainerStyle={styles.menu}
        showsVerticalScrollIndicator={false}
      >
        {menuButtons(false)}
      </ScrollView>

      <Animated.View style={[subtitleStyle, styles.footer]}>
        <Text style={styles.footerText}>
          {t("home.footer")}
        </Text>
      </Animated.View>
      <SettingsModal visible={settingsVisible} onClose={() => setSettingsVisible(false)} />
    </View>
  );
}

// The wordmark, above every step of the type scale on purpose — it is the one
// thing on the screen that is not text to read.
const WORDMARK_SIZE = 56;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },

  landscapeRow: { flex: 1, flexDirection: "row" },
  landscapeLeft: {
    width: "38%",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    gap: 8,
    borderRightWidth: 1,
    borderRightColor: Colors.border,
  },
  landscapeRight: { flex: 1 },
  landscapeMenuContent: {
    padding: 16,
    gap: 10,
    justifyContent: "center",
  },
  titleLandscape: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.hero,
    color: Colors.text,
    letterSpacing: 8,
    textAlign: "center",
  },
  titleUnderlineLandscape: { width: 110, alignSelf: "center", marginTop: 2 },
  subtitleLandscape: {
    fontFamily: "Inter_400Regular",
    fontSize: FontSize.xxs,
    color: Colors.gold,
    letterSpacing: 3,
    textTransform: "uppercase",
    textAlign: "center",
  },
  cardDecorationLandscape: { flexDirection: "row", gap: 12, paddingVertical: 6 },
  suitDecorSmall: { fontSize: FontSize.lg, opacity: 0.7 },
  userRowLandscape: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    flexWrap: "wrap",
  },
  userTextSmall: { fontFamily: "Inter_500Medium", fontSize: FontSize.xs, color: Colors.text, maxWidth: 100 },

  header: { alignItems: "center", paddingTop: 40, paddingBottom: 12, gap: 6 },
  title: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: WORDMARK_SIZE,
    color: Colors.text,
    letterSpacing: 12,
    textAlign: "center",
  },
  titleUnderline: { width: 160, alignSelf: "center", marginTop: 4 },
  devBadge: {
    backgroundColor: Colors.danger,
    borderRadius: Radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignSelf: "center",
  },
  devBadgeText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: FontSize.xxs,
    color: Colors.white,
    letterSpacing: 1,
  },
  subtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: FontSize.sm,
    color: Colors.gold,
    letterSpacing: 4,
    textTransform: "uppercase",
    textAlign: "center",
    marginTop: 4,
  },
  userRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 4,
  },
  userText: { fontFamily: "Inter_500Medium", fontSize: FontSize.sm, color: Colors.text },
  logoutBtn: { paddingHorizontal: 8, paddingVertical: 2 },
  logoutText: { fontFamily: "Inter_400Regular", fontSize: FontSize.xs, color: Colors.textMuted },
  friendsBtn: {
    position: "relative",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.gold,
    borderRadius: Radius.lg,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  friendsBtnCompact: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: Colors.gold,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: Radius.md,
  },
  friendsBtnText: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.sm,
    color: Colors.bgCard,
    letterSpacing: 0.5,
  },
  settingsBtn: {
    width: TOUCH_TARGET_MIN,
    height: TOUCH_TARGET_MIN,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: TOUCH_TARGET_MIN / 2,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  badge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: Radius.full,
    backgroundColor: Colors.danger,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    borderWidth: 1.5,
    borderColor: Colors.bg,
  },
  badgeText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: FontSize.xxs,
    color: Colors.white,
    lineHeight: 13,
  },
  cardDecoration: { flexDirection: "row", justifyContent: "center", gap: 20, paddingVertical: 24 },
  suitDecor: { fontSize: FontSize.xl, opacity: 0.7 },
  menuScroll: { flex: 1 },
  menu: { flexGrow: 1, paddingHorizontal: 24, justifyContent: "center", gap: 12 },
  menuButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.bgSurface,
    borderRadius: Radius.md,
    paddingVertical: 18,
    paddingHorizontal: 20,
    gap: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  menuButtonCompact: { paddingVertical: 12, paddingHorizontal: 16 },
  // Zeroed as longhands, not as `padding: 0`: the base style sets
  // paddingVertical/paddingHorizontal, and React Native resolves the longhand
  // over the shorthand whatever the order. The shorthand left the padding in
  // place, so the gradient — which carries its own padding and is meant to
  // reach the edges — sat inset inside the border with its own square corners
  // showing against the rounded container.
  menuButtonAccent: {
    paddingVertical: 0,
    paddingHorizontal: 0,
    overflow: "hidden",
    borderColor: Colors.gold,
  },
  menuButtonDisabled: { borderColor: Colors.border, opacity: 0.5 },
  accentGradient: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 18,
    paddingHorizontal: 20,
    gap: 14,
  },
  accentGradientCompact: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 12,
  },
  menuLabel: {
    flex: 1,
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: FontSize.lg,
    color: Colors.text,
    letterSpacing: 0.5,
  },
  menuLabelCompact: { fontSize: FontSize.md },
  menuLabelAccent: { color: Colors.bgCard, fontFamily: "Rajdhani_700Bold" },
  floatingCard: {
    position: "absolute",
    top: "12%",
    borderRadius: Radius.sm,
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
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.goldBorder,
  },
  footer: { alignItems: "center", paddingTop: 20 },
  footerText: { fontFamily: "Inter_400Regular", fontSize: FontSize.xs, color: Colors.textMuted, letterSpacing: 1 },
});
