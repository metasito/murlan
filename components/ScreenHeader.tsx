// The bar every menu screen opens with: a way back, a centred title, and
// whatever that screen puts on the right.
//
// The title is centred by balancing the back control with a spacer of the same
// width, so it has to be the control's own width rather than a number that
// happens to be close to it.
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { router } from "expo-router";
import { IconButton } from "@/components/IconButton";
import { Colors, FontSize, Spacing, TOUCH_TARGET_MIN, Type } from "@/lib/theme";
import { useTranslation } from "@/lib/i18n";

export function ScreenHeader({
  title,
  onBack,
  right,
  backLabel,
}: {
  /** Omitted only where the screen has no name to give — see app/auth.tsx. */
  title?: string;
  /** Defaults to going back. Pass one where leaving needs a confirmation. */
  onBack?: () => void;
  /** Sits opposite the back control; the spacer that centres the title if absent. */
  right?: React.ReactNode;
  backLabel?: string;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.bar}>
      <IconButton
        name="chevron-back"
        label={backLabel ?? t("common.back")}
        onPress={onBack ?? (() => router.back())}
      />
      {title === undefined ? <View style={styles.fill} /> : <Text style={styles.title}>{title}</Text>}
      {right ?? <View style={styles.balance} />}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    paddingBottom: Spacing.sm,
    marginBottom: Spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  title: {
    flex: 1,
    textAlign: "center",
    ...Type.heading,
    fontSize: FontSize.xl,
    letterSpacing: 3,
  },
  fill: { flex: 1 },
  balance: { width: TOUCH_TARGET_MIN },
});
