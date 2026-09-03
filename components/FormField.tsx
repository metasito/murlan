import React, { ReactNode } from "react";
import { View, Text, StyleSheet } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { a11yHidden } from "@/lib/a11y";
import { Colors, FontSize, Radius, Spacing, TOUCH_TARGET_MIN, Type } from "@/lib/theme";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

const BODY_LINE_H = FontSize.sm * 1.4;

/**
 * The labelled input row every account screen is built out of. `children` is
 * the field itself rather than a `<TextInput>` prop set, because a row can
 * carry more than the input — a reveal-password toggle, an `useA11yHint`
 * node — and those sit inside the same bordered box.
 *
 * Use `fieldInput` for the `<TextInput>`'s own style: the row is a flex
 * container, so an input that does not claim the remaining width collapses
 * to its content.
 */
export function FormField({
  label,
  icon,
  children,
}: {
  label: string;
  icon: IconName;
  children: ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>
        <Ionicons name={icon} size={ICON} color={Colors.textMuted} {...a11yHidden()} />
        {children}
      </View>
    </View>
  );
}

/**
 * A sentence about what just happened, announced rather than landed on — so
 * it is a live region and never `accessible`, which would make it a leaf
 * with no label of its own to speak.
 */
export function FormNotice({ tone, text }: { tone: "error" | "success"; text: string }) {
  const error = tone === "error";
  return (
    <View style={[styles.notice, error ? styles.noticeError : styles.noticeSuccess]} accessibilityLiveRegion="polite">
      <Ionicons
        name={error ? "alert-circle-outline" : "checkmark-circle-outline"}
        size={NOTICE_ICON}
        color={error ? Colors.dangerDim : Colors.accent}
        {...a11yHidden()}
      />
      <Text style={[styles.noticeText, error ? styles.noticeTextError : styles.noticeTextSuccess]}>{text}</Text>
    </View>
  );
}

const ICON = 16;
const NOTICE_ICON = 14;

export const fieldStyles = StyleSheet.create({
  input: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: FontSize.md,
    color: Colors.text,
  },
  body: { ...Type.body, lineHeight: BODY_LINE_H },
});

const styles = StyleSheet.create({
  field: { gap: Spacing.sm },
  label: {
    ...Type.label,
    fontSize: FontSize.xs,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.wide,
    paddingVertical: Spacing.wide,
    minHeight: TOUCH_TARGET_MIN,
    gap: Spacing.snug,
  },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    borderRadius: Radius.sm,
    padding: Spacing.cosy,
  },
  noticeError: { backgroundColor: Colors.redMuted },
  noticeSuccess: { backgroundColor: Colors.accentMuted },
  noticeText: { fontFamily: "Inter_400Regular", fontSize: FontSize.sm, flex: 1 },
  noticeTextError: { color: Colors.dangerDim },
  noticeTextSuccess: { color: Colors.accent },
});
