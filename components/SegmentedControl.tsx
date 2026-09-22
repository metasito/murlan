import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Colors, Radius, Spacing, TOUCH_TARGET_MIN, Type } from "@/lib/theme";
import { a11yHidden, a11yState } from "@/lib/a11y";

interface Segment<K extends string> {
  key: K;
  label: string;
}

interface SegmentedControlProps<K extends string> {
  segments: readonly Segment<K>[];
  selected: K;
  onSelect: (key: K) => void;
  testID?: string;
}

/** A row of mutually exclusive views of one screen, exposed as tabs. */
export function SegmentedControl<K extends string>({ segments, selected, onSelect, testID }: SegmentedControlProps<K>) {
  return (
    <View style={styles.track} accessibilityRole="tablist" testID={testID}>
      {segments.map((s) => {
        const active = s.key === selected;
        return (
          <Pressable
            key={s.key}
            testID={testID ? `${testID}-${s.key}` : undefined}
            onPress={() => onSelect(s.key)}
            accessibilityLabel={s.label}
            {...a11yState({ role: "tab", selected: active })}
            style={[styles.segment, active && styles.segmentActive]}
          >
            <Text style={[styles.label, active && styles.labelActive]} {...a11yHidden()}>
              {s.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: "row",
    gap: Spacing.xxs,
    padding: Spacing.xxs,
    borderRadius: Radius.md,
    backgroundColor: Colors.bgSurface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  segment: {
    flex: 1,
    minHeight: TOUCH_TARGET_MIN,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.bgClear,
  },
  segmentActive: { backgroundColor: Colors.goldMuted, borderColor: Colors.goldStrong },
  label: { ...Type.label, color: Colors.textSecondary },
  labelActive: { color: Colors.gold },
});
