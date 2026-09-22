import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Colors, Spacing, Radius, FontSize, Type, TOUCH_TARGET_MIN } from "@/lib/theme";
import { a11yHidden, a11yState } from "@/lib/a11y";
import { hapticSelection } from "@/lib/device/haptics";

export interface Choice<T> {
  value: T;
  label: string;
  /** The second line, smaller, under the label. */
  detail?: string;
  /** Spoken instead of the label, where the label alone is a bare digit. */
  a11yLabel?: string;
  /** The caller builds it, so an icon name stays a literal `scripts/iconSubsetChars.mjs` can see. */
  icon?: (active: boolean) => React.ReactNode;
}

/** How much the label weighs: a bare count reads bigger than a sentence. */
type Weight = "caption" | "label" | "title" | "digit";

export function ChoiceChips<T extends string | number>({
  choices,
  value,
  onChange,
  weight = "label",
  fill = true,
  compact = false,
  disabled = false,
  a11yLabel,
}: {
  choices: Choice<T>[];
  value: T;
  onChange: (value: T) => void;
  weight?: Weight;
  /** Each chip takes an equal share of the row; off, they size to their words. */
  fill?: boolean;
  compact?: boolean;
  disabled?: boolean;
  /** Names the set where no visible label does. The row carries the role that makes it reachable. */
  a11yLabel?: string;
}) {
  const named = a11yLabel
    ? { accessibilityRole: "radiogroup" as const, accessibilityLabel: a11yLabel }
    : {};
  return (
    <View style={[styles.row, compact && styles.rowCompact, disabled && styles.rowDisabled]} {...named}>
      {choices.map((choice) => {
        const active = choice.value === value;
        return (
          <Pressable
            key={String(choice.value)}
            onPress={() => {
              hapticSelection();
              onChange(choice.value);
            }}
            disabled={disabled}
            accessibilityLabel={choice.a11yLabel ?? choice.label}
            {...a11yState({ role: "radio", selected: active, disabled })}
            style={({ pressed }) => [
              styles.chip,
              fill && styles.chipFill,
              compact && styles.chipCompact,
              active && styles.chipActive,
              pressed && styles.chipPressed,
            ]}
          >
            {choice.icon?.(active)}
            <Text
              {...a11yHidden()}
              numberOfLines={1}
              style={[
                weightStyles[weight],
                compact && weight === "digit" && styles.digitCompact,
                active && styles.labelActive,
              ]}
            >
              {choice.label}
            </Text>
            {choice.detail ? (
              <Text {...a11yHidden()} style={[styles.detail, active && styles.detailActive]}>
                {choice.detail}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: Spacing.snug, flexWrap: "wrap" },
  rowCompact: { gap: Spacing.xs },
  rowDisabled: { opacity: 0.4 },
  chip: {
    minWidth: TOUCH_TARGET_MIN,
    minHeight: TOUCH_TARGET_MIN,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.snug,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.bgSurface,
  },
  chipFill: { flex: 1 },
  chipCompact: { paddingVertical: Spacing.xs, paddingHorizontal: Spacing.xs },
  chipActive: { borderColor: Colors.gold, backgroundColor: Colors.goldMuted },
  chipPressed: { opacity: 0.8 },
  digitCompact: { fontSize: FontSize.lg },
  labelActive: { color: Colors.gold },
  detail: { ...Type.caption, textAlign: "center", width: "100%" },
  detailActive: { color: Colors.goldLight },
});

const weightStyles = StyleSheet.create({
  caption: { ...Type.caption, color: Colors.textMuted },
  label: { fontFamily: "Rajdhani_600SemiBold", fontSize: FontSize.sm, color: Colors.textSecondary },
  title: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.md,
    color: Colors.textSecondary,
    letterSpacing: 0.5,
    width: "100%",
    textAlign: "center",
  },
  digit: { fontFamily: "Rajdhani_700Bold", fontSize: FontSize.xl, color: Colors.textSecondary },
});
