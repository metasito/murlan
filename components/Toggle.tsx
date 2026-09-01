import { Pressable, StyleSheet } from "react-native";
import { Opacity, TOUCH_TARGET_MIN } from "@/lib/theme";
import { SwitchVisual } from "@/components/SwitchVisual";
import { a11yState, useA11yHint } from "@/lib/a11y";

/**
 * An on/off switch.
 *
 * Not react-native-web's `Switch`: it builds the focusable
 * `<input role="switch">` itself and gives it nothing but `aria-label`,
 * spreading every other prop onto a wrapper `View` no screen reader focuses.
 * A hint passed to it therefore describes a node nobody lands on, and the
 * wrapper carries a second `role="switch"` of its own.
 */
export function Toggle({
  value,
  onValueChange,
  a11yLabel,
  a11yHint,
  disabled = false,
}: {
  value: boolean;
  onValueChange: (next: boolean) => void;
  a11yLabel: string;
  a11yHint?: string;
  disabled?: boolean;
}) {
  const hint = useA11yHint(a11yHint);

  return (
    <>
      <Pressable
        onPress={() => onValueChange(!value)}
        disabled={disabled}
        accessibilityLabel={a11yLabel}
        {...a11yState({ role: "switch", checked: value, disabled })}
        {...hint.props}
        style={({ pressed }) => [
          styles.control,
          disabled && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        <SwitchVisual on={value} />
      </Pressable>
      {hint.node}
    </>
  );
}

const styles = StyleSheet.create({
  // The Pressable's own box is the whole target: react-native-web reads
  // `hitSlop` on nothing but the legacy Touchable.
  control: {
    minWidth: TOUCH_TARGET_MIN,
    minHeight: TOUCH_TARGET_MIN,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  disabled: { opacity: Opacity.disabled },
  pressed: { opacity: Opacity.pressed },
});
