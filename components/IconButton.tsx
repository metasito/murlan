// A control that is only a glyph.
//
// Its box is the touch target rather than its glyph plus hitSlop, because
// react-native-web reads `hitSlop` on nothing but the legacy Touchable — on
// the shipped platform the box is all there is.
import React from "react";
import { Pressable, StyleSheet } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Colors, Opacity, TOUCH_TARGET_MIN } from "@/lib/theme";
import { a11yHidden, a11yState } from "@/lib/a11y";

const GLYPH = 22;

/**
 * `name` is a prop, and the icon subset resolver follows a prop back to its
 * call sites — so every caller must pass a literal or a ternary between two
 * literals. A name assembled any other way ships a glyph the subset does not
 * carry, which renders as a blank box with no error (tests/iconSubset.test.ts).
 */
export function IconButton({
  name,
  label,
  onPress,
  disabled = false,
  size = GLYPH,
  color = Colors.gold,
  style,
  testID,
}: {
  name: React.ComponentProps<typeof Ionicons>["name"];
  /** What the control does. The glyph itself is hidden, so this is the only name it has. */
  label: string;
  onPress: () => void;
  disabled?: boolean;
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.box,
        style,
        disabled && { opacity: Opacity.disabled },
        pressed && !disabled && { opacity: Opacity.pressed },
      ]}
      accessibilityLabel={label}
      testID={testID}
      {...a11yState({ role: "button", disabled })}
    >
      <Ionicons name={name} size={size} color={color} {...a11yHidden()} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    minWidth: TOUCH_TARGET_MIN,
    minHeight: TOUCH_TARGET_MIN,
    alignItems: "center",
    justifyContent: "center",
  },
});
