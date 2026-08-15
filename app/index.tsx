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
import * as Haptics from "expo-haptics";
import { Ionicons, Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { Colors } from '@/lib/theme';
import { useTranslation } from "@/lib/i18n";
import { SettingsModal } from "@/components/SettingsModal";

interface MenuButtonProps {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  onPress: () => void;
  delay?: number;
  accent?: boolean;
  disabled?: boolean;
  compact?: boolean;
}

function MenuButton({
  label,
  icon,
  onPress,
  delay = 0,
  accent = false,
  disabled = false,
  compact = false,
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
            <Ionicons name={icon} size={compact ? 18 : 20} color="#0A1F18" />
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
  const translateY = useSharedValue(0);
  const rotate = useSharedValue(0);

  useEffect(() => {
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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
      <Ionicons name="people" size={compact ? 16 : 20} color={compact ? Colors.gold : "#0A1F18"} />
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
  const { t } = useTranslation();
  const { width: W, height: H } = useWindowDimensions();
  const isLandscape = W > H;
  const [settingsVisible, setSettingsVisible] = useState(false);

  const titleOpacity = useSharedValue(0);
  const titleScale = useSharedValue(0.85);
  const subtitleOpacity = useSharedValue(0);

  useEffect(() => {
    titleOpacity.value = withDelay(200, withTiming(1, { duration: 700 }));
    titleScale.value = withDelay(200, withTiming(1, { duration: 700, easing: Easing.out(Easing.back(1.5)) }));
    subtitleOpacity.value = withDelay(500, withTiming(1, { duration: 600 }));
  }, []);

  // First-launch onboarding: offer the interactive tutorial automatically, once.
  // Never gates play — the player can skip or navigate away immediately, and
  // the flag is set the moment they do either (see app/tutorial.tsx).
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

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;
  const leftPad = isLandscape ? (Platform.OS === "web" ? 0 : insets.left) : 0;
  const rightPad = isLandscape ? (Platform.OS === "web" ? 0 : insets.right) : 0;

  const menuButtons = (compact: boolean) => (
    <>
      <MenuButton compact={compact} label={t("home.modeOffline")} icon="game-controller" accent onPress={() => router.push({ pathname: "/lobby", params: { mode: "ai" } })} delay={300} />
      <MenuButton compact={compact} label={t("home.modePlayWithFriends")} icon="people" onPress={() => { if (user) router.push("/(online)"); else router.push("/auth"); }} delay={420} />
      <MenuButton compact={compact} label={t("home.modeOnline")} icon="earth-outline" onPress={() => { if (user) router.push("/(online)/quickmatch"); else router.push("/auth"); }} delay={540} />
      <MenuButton compact={compact} label={t("home.modeTutorial")} icon="school-outline" onPress={() => router.push("/tutorial")} delay={600} />
      <MenuButton compact={compact} label={t("home.modeRules")} icon="book-outline" onPress={() => router.push("/rules")} delay={660} />
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
                <LinearGradient colors={[Colors.goldDark, Colors.gold, Colors.goldDark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flex: 1, height: 2, borderRadius: 1 }} />
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
            <LinearGradient colors={[Colors.goldDark, Colors.gold, Colors.goldDark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flex: 1, height: 2, borderRadius: 1 }} />
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

      <View style={styles.menu}>
        {menuButtons(false)}
      </View>

      <Animated.View style={[subtitleStyle, styles.footer]}>
        <Text style={styles.footerText}>
          {t("home.footer")}
        </Text>
      </Animated.View>
      <SettingsModal visible={settingsVisible} onClose={() => setSettingsVisible(false)} />
    </View>
  );
}

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
    fontSize: 38,
    color: Colors.text,
    letterSpacing: 8,
    textAlign: "center",
  },
  titleUnderlineLandscape: { width: 110, alignSelf: "center", marginTop: 2 },
  subtitleLandscape: {
    fontFamily: "Inter_400Regular",
    fontSize: 10,
    color: Colors.gold,
    letterSpacing: 3,
    textTransform: "uppercase",
    textAlign: "center",
  },
  cardDecorationLandscape: { flexDirection: "row", gap: 12, paddingVertical: 6 },
  suitDecorSmall: { fontSize: 18, opacity: 0.7 },
  userRowLandscape: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    flexWrap: "wrap",
  },
  userTextSmall: { fontFamily: "Inter_500Medium", fontSize: 11, color: Colors.text, maxWidth: 100 },

  header: { alignItems: "center", paddingTop: 40, paddingBottom: 12, gap: 6 },
  title: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 56,
    color: Colors.text,
    letterSpacing: 12,
    textAlign: "center",
  },
  titleUnderline: { width: 160, alignSelf: "center", marginTop: 4 },
  devBadge: {
    backgroundColor: "#c0392b",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignSelf: "center",
  },
  devBadgeText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 10,
    color: "#fff",
    letterSpacing: 1,
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
  userRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 4,
  },
  userText: { fontFamily: "Inter_500Medium", fontSize: 13, color: Colors.text },
  logoutBtn: { paddingHorizontal: 8, paddingVertical: 2 },
  logoutText: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textMuted },
  friendsBtn: {
    position: "relative",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.gold,
    borderRadius: 20,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  friendsBtnCompact: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: Colors.gold,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 14,
  },
  friendsBtnText: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 14,
    color: "#0A1F18",
    letterSpacing: 0.5,
  },
  settingsBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  badge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#e74c3c",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    borderWidth: 1.5,
    borderColor: Colors.bg,
  },
  badgeText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 10,
    color: "#fff",
    lineHeight: 13,
  },
  cardDecoration: { flexDirection: "row", justifyContent: "center", gap: 20, paddingVertical: 24 },
  suitDecor: { fontSize: 24, opacity: 0.7 },
  menu: { flex: 1, paddingHorizontal: 24, justifyContent: "center", gap: 12 },
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
  menuButtonCompact: { paddingVertical: 12, paddingHorizontal: 16 },
  menuButtonAccent: { padding: 0, overflow: "hidden", borderColor: Colors.gold },
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
    fontSize: 18,
    color: Colors.text,
    letterSpacing: 0.5,
  },
  menuLabelCompact: { fontSize: 15 },
  menuLabelAccent: { color: "#0A1F18", fontFamily: "Rajdhani_700Bold" },
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
  footer: { alignItems: "center", paddingTop: 20 },
  footerText: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textMuted, letterSpacing: 1 },
});
