import { Pressable, StyleSheet, View } from "react-native";
import { Colors, Radius, TOUCH_TARGET_MIN } from "@/lib/theme";
import { a11yHidden, a11yState, useA11yHint } from "@/lib/a11y";

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
        <View style={[styles.track, value && styles.trackOn]} {...a11yHidden()}>
          <View style={[styles.thumb, value ? styles.thumbOn : styles.thumbOff]} />
        </View>
      </Pressable>
      {hint.node}
    </>
  );
}

const TRACK_W = 52;
const TRACK_H = 32;
const THUMB = 24;
const THUMB_INSET = (TRACK_H - THUMB) / 2;
const PRESSED_OPACITY = 0.8;
const DISABLED_OPACITY = 0.4;

const styles = StyleSheet.create({
  // The Pressable's own box is the whole target: react-native-web reads
  // `hitSlop` on nothing but the legacy Touchable.
  control: {
    minWidth: TOUCH_TARGET_MIN,
    minHeight: TOUCH_TARGET_MIN,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  disabled: { opacity: DISABLED_OPACITY },
  pressed: { opacity: PRESSED_OPACITY },
  track: {
    width: TRACK_W,
    height: TRACK_H,
    justifyContent: "center",
    borderRadius: Radius.full,
    backgroundColor: Colors.bgElevated,
  },
  trackOn: { backgroundColor: Colors.gold },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: Radius.full,
    position: "absolute",
  },
  thumbOff: { left: THUMB_INSET, backgroundColor: Colors.textMuted },
  thumbOn: { right: THUMB_INSET, backgroundColor: Colors.white },
});
