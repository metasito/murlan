// A player, as a circle: the initial of their name, or the glyph for a seat
// nobody is in yet.
//
// One scale for the whole app. Six hand-rolled copies had drifted to six
// diameters (28, 30, 36, 42, 48, 52) and four initial sizes, and the two that
// stand for *you* — the home screen and the profile — were four pixels apart
// on the same identity.
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Colors, FontSize, Radius } from "@/lib/theme";
import { a11yHidden } from "@/lib/a11y";

export type AvatarSize = "sm" | "md" | "lg" | "xl";

const DIAMETER: Record<AvatarSize, number> = { sm: 30, md: 36, lg: 42, xl: 52 };
const INITIAL: Record<AvatarSize, number> = {
  sm: FontSize.sm,
  md: FontSize.md,
  lg: FontSize.lg,
  xl: FontSize.xl,
};
/** The empty-seat glyph, kept a little inside the circle at every step. */
const GLYPH_RATIO = 0.44;
const RING = 1;
const DOT_RATIO = 0.26;
const DOT_BORDER = 2;

export function Avatar({
  name,
  size = "md",
  ring = false,
  /** Undefined draws no dot at all — an avatar with no presence to report. */
  online,
  style,
}: {
  /** Absent for a seat still waiting: the circle then carries the invite glyph. */
  name?: string;
  size?: AvatarSize;
  /** The hairline that marks the signed-in account's own avatar. */
  ring?: boolean;
  online?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const d = DIAMETER[size];
  const dot = Math.round(d * DOT_RATIO);
  return (
    <View
      style={[
        styles.circle,
        { width: d, height: d },
        name === undefined && styles.vacant,
        ring && styles.ring,
        style,
      ]}
      {...a11yHidden()}
    >
      {name === undefined ? (
        <Ionicons
          name="person-add-outline"
          size={Math.round(d * GLYPH_RATIO)}
          color={Colors.textMuted}
        />
      ) : (
        <Text style={[styles.initial, { fontSize: INITIAL[size] }]}>
          {name.charAt(0).toUpperCase()}
        </Text>
      )}
      {online !== undefined && (
        <View
          style={[
            styles.dot,
            { width: dot, height: dot },
            { backgroundColor: online ? Colors.success : Colors.textMuted },
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    borderRadius: Radius.full,
    backgroundColor: Colors.felt,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  vacant: { backgroundColor: Colors.bgCard },
  ring: { borderWidth: RING, borderColor: Colors.gold },
  initial: { fontFamily: "Rajdhani_700Bold", color: Colors.gold },
  dot: {
    position: "absolute",
    bottom: 0,
    right: 0,
    borderRadius: Radius.full,
    borderWidth: DOT_BORDER,
    borderColor: Colors.bgSurface,
  },
});
