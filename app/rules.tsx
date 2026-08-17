import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
} from "react-native";
import { router } from "expo-router";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { Colors, Spacing, FontSize, Type } from "@/lib/theme";
import { MenuLayout } from "@/components/MenuLayout";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { useTranslation, type TranslationKey } from "@/lib/i18n";

interface FAQ {
  question: string;
  answer: string;
}

const FAQ_COUNT = 18;

function useFaqs(): FAQ[] {
  const { t } = useTranslation();
  return React.useMemo(
    () =>
      Array.from({ length: FAQ_COUNT }, (_, i) => {
        const n = i + 1;
        return {
          question: t(`rules.faq.q${n}` as TranslationKey),
          answer: t(`rules.faq.a${n}` as TranslationKey),
        };
      }),
    [t]
  );
}

function FAQItem({ item, isLast }: { item: FAQ; isLast: boolean }) {
  const reduceMotion = usePrefersReducedMotion();
  const [open, setOpen] = useState(false);
  const height = useSharedValue(0);
  const opacity = useSharedValue(0);

  const toggleOpen = () => {
    const nextOpen = !open;
    const to = nextOpen ? 1 : 0;
    setOpen(nextOpen);
    if (reduceMotion) {
      height.value = to;
      opacity.value = to;
      return;
    }
    height.value = withTiming(to, { duration: 280 });
    opacity.value = withTiming(to, { duration: 200 });
  };

  const answerStyle = useAnimatedStyle(() => ({
    maxHeight: height.value * 400,
    opacity: opacity.value,
    overflow: "hidden",
  }));

  return (
    <View style={[styles.faqItem, isLast && styles.faqItemLast]}>
      <Pressable
        onPress={toggleOpen}
        style={styles.faqQuestion}
        accessibilityRole="button"
        accessibilityLabel={item.question}
        accessibilityState={{ expanded: open }}
        hitSlop={4}
      >
        <Text style={styles.faqQuestionText}>{item.question}</Text>
        <Ionicons
          name={open ? "chevron-up" : "chevron-down"}
          size={16}
          color={Colors.gold}
        />
      </Pressable>
      <Animated.View style={answerStyle}>
        <Text style={styles.faqAnswer}>{item.answer}</Text>
      </Animated.View>
    </View>
  );
}

export default function RulesScreen() {
  const { t } = useTranslation();
  const faqs = useFaqs();

  return (
    <MenuLayout scrollable centered={false}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel={t("common.back")}
          hitSlop={12}
        >
          <Ionicons name="chevron-back" size={22} color={Colors.gold} />
        </Pressable>
        <Text style={styles.screenTitle}>{t("rules.headerTitle")}</Text>
        <View style={{ width: 38 }} />
      </View>

      <View style={styles.contentWrapper}>
        <View style={styles.heroBanner}>
          <LinearGradient
            colors={[Colors.bgSurface, Colors.bgElevated]}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.heroSuits}>
            {["♠", "♥", "♦", "♣"].map((s, i) => (
              <Text
                key={s}
                style={[styles.heroSuit, { color: i % 2 === 0 ? Colors.textMuted : Colors.red }]}
              >
                {s}
              </Text>
            ))}
          </View>
          <Text style={styles.heroTitle}>{t("rules.heroTitle")}</Text>
          <Text style={styles.heroSubtitle}>{t("rules.heroSubtitle")}</Text>
          <Pressable
            onPress={() => router.push("/tutorial")}
            style={styles.tutorialLink}
            accessibilityRole="link"
            accessibilityLabel={t("rules.tutorialLink")}
            hitSlop={12}
          >
            <Ionicons name="school-outline" size={14} color={Colors.gold} />
            <Text style={styles.tutorialLinkText}>{t("rules.tutorialLink")}</Text>
            <Ionicons name="chevron-forward" size={14} color={Colors.gold} />
          </Pressable>
        </View>

        <View style={styles.quickRef}>
          <Text style={styles.sectionLabel}>{t("rules.strengthSectionLabel")}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strengthRow}>
            {[
              { rank: "JKR★", color: Colors.danger, label: t("rules.strengthJokerColored") },
              { rank: "JKR☆", color: Colors.textMuted, label: t("rules.strengthJokerBlack") },
              { rank: "2", color: Colors.text, label: t("rules.strengthTwo") },
              { rank: "A", color: Colors.text, label: t("rules.strengthAce") },
              { rank: "K", color: Colors.text, label: t("rules.strengthKing") },
              { rank: "Q", color: Colors.text, label: t("rules.strengthQueen") },
              { rank: "J", color: Colors.text, label: t("rules.strengthJack") },
              { rank: "10", color: Colors.text, label: t("rules.strengthTen") },
              { rank: "3", color: Colors.textMuted, label: t("rules.strengthThree") },
            ].map((item) => (
              <View key={item.rank} style={styles.strengthCard}>
                <Text style={[styles.strengthRank, { color: item.color }]}>{item.rank}</Text>
                <Text style={styles.strengthLabel}>{item.label}</Text>
              </View>
            ))}
          </ScrollView>
        </View>

        <View style={styles.combosSection}>
          <Text style={styles.sectionLabel}>{t("rules.combosSectionLabel")}</Text>
          <View style={styles.comboGrid}>
            {[
              { name: t("rules.comboSingleName"), desc: t("rules.comboSingleDesc"), icon: "card" },
              { name: t("rules.comboPairName"), desc: t("rules.comboPairDesc"), icon: "copy" },
              { name: t("rules.comboTripleName"), desc: t("rules.comboTripleDesc"), icon: "layers" },
              { name: t("rules.comboStraightName"), desc: t("rules.comboStraightDesc"), icon: "trending-up" },
              { name: t("rules.comboBombName"), desc: t("rules.comboBombDesc"), icon: "flash" },
              { name: t("rules.comboRoyalName"), desc: t("rules.comboRoyalDesc"), icon: "star" },
            ].map((c) => (
              <View key={c.name} style={styles.comboCard}>
                <Ionicons
                  name={c.icon as React.ComponentProps<typeof Ionicons>["name"]}
                  size={22}
                  color={Colors.gold}
                />
                <Text style={styles.comboName}>{c.name}</Text>
                <Text style={styles.comboDesc}>{c.desc}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.faqSection}>
          <Text style={styles.sectionLabel}>{t("rules.faqSectionLabel")}</Text>
          <View style={styles.faqList}>
            {faqs.map((item, i) => (
              <FAQItem key={i} item={item} isLast={i === faqs.length - 1} />
            ))}
          </View>
        </View>
      </View>
    </MenuLayout>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    paddingBottom: Spacing.sm,
    marginBottom: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  screenTitle: {
    flex: 1,
    textAlign: "center",
    ...Type.heading,
    fontSize: FontSize.xl,
    letterSpacing: 3,
  },
  contentWrapper: {
    width: "100%",
    maxWidth: 800,
    alignSelf: "center",
    gap: Spacing.lg,
  },

  heroBanner: {
    borderRadius: 16,
    overflow: "hidden",
    padding: 24,
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  heroSuits: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 8,
  },
  heroSuit: {
    fontSize: 20,
    opacity: 0.8,
  },
  heroTitle: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 36,
    color: Colors.text,
    letterSpacing: 8,
  },
  heroSubtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: Colors.gold,
    letterSpacing: 3,
    textTransform: "uppercase",
  },
  tutorialLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: Colors.goldMuted,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tutorialLinkText: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
    color: Colors.gold,
    textAlign: "center",
    flexShrink: 1,
  },

  quickRef: {
    gap: 12,
  },
  sectionLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 10,
    color: Colors.textMuted,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  strengthRow: {
    gap: 8,
    paddingVertical: 4,
  },
  strengthCard: {
    backgroundColor: Colors.bgSurface,
    borderRadius: 10,
    padding: 12,
    alignItems: "center",
    gap: 4,
    minWidth: 58,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  strengthRank: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 16,
  },
  strengthLabel: {
    fontFamily: "Inter_400Regular",
    fontSize: 9,
    color: Colors.textMuted,
    textAlign: "center",
  },

  combosSection: {
    gap: 12,
  },
  comboGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  comboCard: {
    flex: 1,
    minWidth: "44%",
    backgroundColor: Colors.bgSurface,
    borderRadius: 12,
    padding: 16,
    gap: 6,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "flex-start",
  },
  comboName: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 15,
    color: Colors.text,
  },
  comboDesc: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 16,
  },

  faqSection: {
    gap: 12,
  },
  faqList: {
    backgroundColor: Colors.bgSurface,
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  faqItem: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingHorizontal: 16,
  },
  faqItemLast: {
    borderBottomWidth: 0,
  },
  faqQuestion: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    minHeight: 44,
    gap: 12,
  },
  faqQuestionText: {
    flex: 1,
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 15,
    color: Colors.text,
    lineHeight: 20,
  },
  faqAnswer: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 20,
    paddingBottom: 14,
  },
});
