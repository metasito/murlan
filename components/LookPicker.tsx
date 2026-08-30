import React from "react";
import { View, Text, Pressable, StyleSheet, ScrollView } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { CardView } from "@/components/CardView";
import type { Card } from "@/lib/gameEngine";
import { MenuCard } from "@/components/MenuCard";
import { useSettings } from "@/context/SettingsContext";
import { useTranslation } from "@/lib/i18n";
import { a11yHidden, a11yState } from "@/lib/a11y";
import {
  CARD_BACK_IDS,
  TABLE_FELT_IDS,
  cardBackNameKey,
  getTableFelt,
  tableFeltNameKey,
  type CardBackId,
  type TableFeltId,
} from "@/lib/cosmetics";
import { Colors, FontSize, Radius, Spacing, TOUCH_TARGET_MIN } from "@/lib/theme";

/**
 * The card back is drawn by `CardView` itself rather than by a swatch that
 * approximates it: a chip showing two of the back's five stops is not what the
 * player is choosing between, and the lattice is most of what tells the five
 * apart. `backId` exists on `CardView` for exactly this — a picker cannot show
 * five copies of the currently chosen back.
 */
const PREVIEW_SCALE = 1.5;
/** Enough cloth to read as cloth. A felt is a field, not a colour. */
const FELT_W = 92;
const FELT_H = 62;

/** Face-down previews never draw a face; `CardView` still needs a card. */
const STAND_IN: Card = { id: "preview", rank: "3", suit: "spades", isJoker: false };

function Option({
  label,
  selected,
  onPress,
  children,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.option, selected && styles.optionSelected]}
      {...a11yState({ role: "button", selected })}
      accessibilityLabel={label}
    >
      <View {...a11yHidden()}>{children}</View>
      <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]} {...a11yHidden()}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * How the game looks, for anyone — this is the section that has to work with
 * no account, which is why the screen lives outside the `(online)` group.
 * Cosmetics are local (`lib/cosmetics.ts`, #98), so a choice made here costs
 * nothing to store and survives getting an account.
 */
export function LookPicker() {
  const { t } = useTranslation();
  const { cardBack, setCardBack, tableFelt, setTableFelt } = useSettings();

  return (
    <MenuCard>
      <View testID="profile-look" style={styles.body}>
        <Text style={styles.groupLabel}>{t("profile.lookCardBack")}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          {CARD_BACK_IDS.map((id: CardBackId) => (
            <Option
              key={id}
              label={t(cardBackNameKey(id))}
              selected={id === cardBack}
              onPress={() => setCardBack(id)}
            >
              <CardView card={STAND_IN} faceDown backId={id} scale={PREVIEW_SCALE} decorative noLift />
            </Option>
          ))}
        </ScrollView>

        <Text style={styles.groupLabel}>{t("profile.lookTableFelt")}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          {TABLE_FELT_IDS.map((id: TableFeltId) => {
            const stops = getTableFelt(id);
            return (
              <Option
                key={id}
                label={t(tableFeltNameKey(id))}
                selected={id === tableFelt}
                onPress={() => setTableFelt(id)}
              >
                <LinearGradient
                  colors={[stops[0], stops[2], stops[4]]}
                  start={{ x: 0.2, y: 0 }}
                  end={{ x: 0.8, y: 1 }}
                  style={styles.felt}
                />
              </Option>
            );
          })}
        </ScrollView>
      </View>
    </MenuCard>
  );
}

const styles = StyleSheet.create({
  body: { gap: Spacing.sm },
  groupLabel: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: FontSize.xs,
    letterSpacing: 1.4,
    color: Colors.textMuted,
    textTransform: "uppercase",
  },
  row: { gap: Spacing.sm, paddingVertical: Spacing.xxs },
  option: {
    minWidth: TOUCH_TARGET_MIN,
    minHeight: TOUCH_TARGET_MIN,
    alignItems: "center",
    gap: Spacing.xxs,
    padding: Spacing.xs,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.goldSoft,
    backgroundColor: Colors.goldGhost,
  },
  optionSelected: { borderColor: Colors.goldStrong, backgroundColor: Colors.goldMuted },
  optionLabel: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
  },
  optionLabelSelected: { color: Colors.goldLight },
  felt: { width: FELT_W, height: FELT_H, borderRadius: Radius.sm },
});
