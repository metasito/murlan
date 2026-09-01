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
import Ionicons from "@expo/vector-icons/Ionicons";
import { Colors, FontSize, motionMs, Radius, Spacing, TOUCH_TARGET_MIN, Type } from "@/lib/theme";
import { ScreenHeader } from "@/components/ScreenHeader";
import { MenuLayout } from "@/components/MenuLayout";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { useTranslation, type TranslationKey } from "@/lib/i18n";
import { a11yHidden, a11yState } from "@/lib/a11y";

interface FAQ {
  question: string;
  answer: string;
}

const FAQ_COUNT = 18;

const CTA_ICON = 18;
const FAQ_ICON = 16;
const NAV_ICON = 22;

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
    height.value = withTiming(to, { duration: motionMs("travel", reduceMotion) });
    opacity.value = withTiming(to, { duration: motionMs("shift", reduceMotion) });
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
        accessibilityLabel={item.question}
        {...a11yState({ role: "button", expanded: open })}
        hitSlop={Spacing.xs}
      >
        <Text style={styles.faqQuestionText} {...a11yHidden()}>{item.question}</Text>
        <Ionicons
          name={open ? "chevron-up" : "chevron-down"}
          size={FAQ_ICON}
          color={Colors.gold}
          {...a11yHidden()}
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
      <ScreenHeader title={t("rules.headerTitle")} />

      <View style={styles.contentWrapper}>
        <View style={styles.heroBanner}>
          <LinearGradient
            colors={[Colors.bgSurface, Colors.bgElevated]}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.heroSuits}>
            {["♠", "♥", "♦", "♣"].map((s) => (
              <Text
                key={s}
                style={[styles.heroSuit, { color: s === "♥" ? Colors.heart : s === "♦" ? Colors.diamond : Colors.textMuted }]}
              >
                {s}
              </Text>
            ))}
          </View>
          <Text style={styles.heroTitle}>{t("rules.heroTitle")}</Text>
          <Text style={styles.heroSubtitle}>{t("rules.heroSubtitle")}</Text>
          <Pressable
            onPress={() => router.push("/tutorial")}
            style={styles.startTutorial}
            accessibilityRole="button"
            accessibilityLabel={t("rules.startTutorialA11yLabel")}
          >
            <Ionicons name="school-outline" size={CTA_ICON} color={Colors.gold} {...a11yHidden()} />
            <View style={styles.startTutorialCopy} {...a11yHidden()}>
              <Text style={styles.startTutorialTitle}>{t("rules.startTutorial")}</Text>
              <Text style={styles.startTutorialSubtitle}>{t("rules.startTutorialSubtitle")}</Text>
            </View>
            <Ionicons name="chevron-forward" size={CTA_ICON} color={Colors.gold} {...a11yHidden()} />
          </Pressable>
        </View>

        <View style={styles.quickRef}>
          <Text style={styles.sectionLabel}>{t("rules.strengthSectionLabel")}</Text>
          {/* Bounded, or the row sizes to its nine cards and takes the page
              sideways with it instead of scrolling inside it: React Native
              defaults `flexShrink` to 0, so a child wider than its parent
              overflows rather than shrinking (`MenuLayout`'s `bounded` carries
              the same note). At 390 the content reached x=612. */}
          <ScrollView
            horizontal
            style={styles.strengthScroller}
            showsHorizontalScrollIndicator
            contentContainerStyle={styles.strengthRow}
          >
            {[
              { rank: "JKR★", color: Colors.bombText, label: t("rules.strengthJokerColored") },
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
                  size={NAV_ICON}
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
  contentWrapper: {
    width: "100%",
    maxWidth: 800,
    alignSelf: "center",
    gap: Spacing.lg,
  },

  heroBanner: {
    borderRadius: Radius.md,
    overflow: "hidden",
    padding: Spacing.lg,
    alignItems: "center",
    gap: Spacing.slim,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  heroSuits: {
    flexDirection: "row",
    gap: Spacing.cosy,
    marginBottom: Spacing.sm,
  },
  heroSuit: {
    fontSize: FontSize.lg,
    opacity: 0.8,
  },
  heroTitle: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.hero,
    color: Colors.text,
    letterSpacing: 8,
  },
  heroSubtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: FontSize.xs,
    color: Colors.gold,
    letterSpacing: 3,
    textTransform: "uppercase",
  },
  startTutorial: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.cosy,
    marginTop: Spacing.cosy,
    paddingHorizontal: Spacing.cosy,
    paddingVertical: Spacing.sm,
    minHeight: TOUCH_TARGET_MIN,
    borderRadius: Radius.sm,
    backgroundColor: Colors.goldMuted,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  startTutorialCopy: {
    flexShrink: 1,
    gap: Spacing.xxs,
  },
  startTutorialTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: FontSize.sm,
    color: Colors.gold,
  },
  startTutorialSubtitle: {
    ...Type.caption,
    // Not caption's own `textMuted`: this sits on a translucent gold chip over
    // the hero gradient, and that composite drops it to 4.45:1, under AA.
    // `tests/contrast.test.ts` pairs tokens with flat surfaces and cannot see it.
    color: Colors.textSecondary,
  },

  quickRef: {
    gap: Spacing.cosy,
  },
  sectionLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: FontSize.xxs,
    color: Colors.textMuted,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  strengthScroller: {
    width: "100%",
    flexGrow: 0,
    flexShrink: 1,
  },
  strengthRow: {
    gap: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  strengthCard: {
    backgroundColor: Colors.bgSurface,
    borderRadius: Radius.sm,
    padding: Spacing.cosy,
    alignItems: "center",
    gap: Spacing.xs,
    minWidth: 58,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  strengthRank: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.md,
  },
  strengthLabel: {
    fontFamily: "Inter_400Regular",
    fontSize: FontSize.xxs,
    color: Colors.textMuted,
    textAlign: "center",
  },

  combosSection: {
    gap: Spacing.cosy,
  },
  comboGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.snug,
  },
  comboCard: {
    flex: 1,
    minWidth: "44%",
    backgroundColor: Colors.bgSurface,
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: Spacing.slim,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "flex-start",
  },
  comboName: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.md,
    color: Colors.text,
  },
  comboDesc: {
    fontFamily: "Inter_400Regular",
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    lineHeight: 16,
  },

  faqSection: {
    gap: Spacing.cosy,
  },
  faqList: {
    backgroundColor: Colors.bgSurface,
    borderRadius: Radius.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  faqItem: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingHorizontal: Spacing.md,
  },
  faqItemLast: {
    borderBottomWidth: 0,
  },
  faqQuestion: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: Spacing.wide,
    minHeight: TOUCH_TARGET_MIN,
    gap: Spacing.cosy,
  },
  faqQuestionText: {
    flex: 1,
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: FontSize.md,
    color: Colors.text,
    lineHeight: 20,
  },
  faqAnswer: {
    fontFamily: "Inter_400Regular",
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
    paddingBottom: Spacing.wide,
  },
});
