import { Platform, StyleSheet, Text } from "react-native";
import type { AccessibilityProps, AccessibilityRole, AccessibilityState } from "react-native";

// react-native-web 0.21's forwarded-prop allow-list
// (modules/forwardedProps/index.js) carries no `accessibilityState`, no
// `accessibilityHint`, no `accessibilityElementsHidden` and no
// `importantForAccessibility`. A control that declares any of those reaches
// the DOM with none of it, so every helper here emits the `aria-*` twin
// alongside the React Native prop.
const isWeb = Platform.OS === "web";

/** Roles whose selected-ness is `aria-checked`; everything else uses `aria-selected`. */
const CHECKED_ROLES = new Set<AccessibilityRole>(["radio", "checkbox", "switch", "menuitem"]);

type StateProps = AccessibilityState & { role?: AccessibilityRole };

/** Accessibility state for a control, on both React Native and the DOM. */
export function a11yState({ role, ...state }: StateProps): AccessibilityProps {
  const props: AccessibilityProps = { accessibilityState: state };
  if (role) props.accessibilityRole = role;
  if (!isWeb) return props;

  if (state.disabled !== undefined) props["aria-disabled"] = state.disabled;
  if (state.busy !== undefined) props["aria-busy"] = state.busy;
  if (state.expanded !== undefined) props["aria-expanded"] = state.expanded;
  if (state.checked !== undefined) props["aria-checked"] = state.checked;
  if (state.selected !== undefined) {
    if (role && CHECKED_ROLES.has(role)) props["aria-checked"] = state.selected;
    else props["aria-selected"] = state.selected;
  }
  return props;
}

/** Hides a decorative subtree from assistive technology on both platforms. */
export function a11yHidden(hidden = true): AccessibilityProps {
  return {
    accessibilityElementsHidden: hidden,
    importantForAccessibility: hidden ? "no-hide-descendants" : "auto",
    "aria-hidden": hidden || undefined,
  };
}

/**
 * A DOM id is the only way to carry a description on the web, so the hint text
 * itself is the id: identical hints describe identically, and the node is
 * rendered by `<A11yHintText>` next to the control.
 */
function hintId(hint: string): string {
  let h = 0;
  for (let i = 0; i < hint.length; i++) h = (Math.imul(h, 31) + hint.charCodeAt(i)) | 0;
  return `a11y-hint-${(h >>> 0).toString(36)}`;
}

/** A control's hint. Pair every call with an `<A11yHintText hint={...} />`. */
export function a11yHint(hint: string | undefined): AccessibilityProps {
  if (!hint) return {};
  const props: AccessibilityProps = { accessibilityHint: hint };
  if (isWeb) (props as Record<string, unknown>)["aria-describedby"] = hintId(hint);
  return props;
}

/** The node `a11yHint`'s `aria-describedby` points at. Renders nothing on native. */
export function A11yHintText({ hint }: { hint: string | undefined }) {
  if (!isWeb || !hint) return null;
  return (
    <Text nativeID={hintId(hint)} style={styles.srOnly}>
      {hint}
    </Text>
  );
}

// Out of flow, one pixel, invisible — but still in the accessibility tree.
// `display: none` and `visibility: hidden` both remove it, which is the whole
// point of not using them.
const SR_ONLY_SIZE = 1;

const styles = StyleSheet.create({
  srOnly: {
    position: "absolute",
    width: SR_ONLY_SIZE,
    height: SR_ONLY_SIZE,
    overflow: "hidden",
    opacity: 0,
  },
});

export const srOnlyStyle = styles.srOnly;
