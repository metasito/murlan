import { useEffect, useId } from "react";
import { Platform, StyleSheet, Text } from "react-native";
import type { AccessibilityProps, AccessibilityRole, AccessibilityState } from "react-native";

// react-native-web 0.21's forwarded-prop allow-list
// (modules/forwardedProps/index.js) carries no `accessibilityState`, no
// `accessibilityHint`, no `accessibilityElementsHidden` and no
// `importantForAccessibility`. A control that declares any of those reaches
// the DOM with none of it, so every helper here emits the `aria-*` twin
// alongside the React Native prop.
const isWeb = Platform.OS === "web";

/** Roles whose selectedness is `aria-selected` (ARIA 1.2 allows it nowhere else). */
const SELECTABLE_ROLES = new Set<AccessibilityRole>(["tab", "menuitem"]);
/** Roles whose selectedness is `aria-checked`. */
const CHECKABLE_ROLES = new Set<AccessibilityRole>(["radio", "checkbox", "switch"]);

type StateProps = AccessibilityState & { role?: AccessibilityRole };

/** Accessibility state for a control, on both React Native and the DOM. */
export function a11yState({ role, ...state }: StateProps): AccessibilityProps {
  const props: AccessibilityProps = { accessibilityState: state };
  if (role) props.accessibilityRole = role;
  if (!isWeb) return props;

  const web = props as Record<string, unknown>;
  if (state.disabled !== undefined) web["aria-disabled"] = state.disabled;
  if (state.busy !== undefined) web["aria-busy"] = state.busy;
  if (state.expanded !== undefined) web["aria-expanded"] = state.expanded;
  if (state.checked !== undefined) web["aria-checked"] = state.checked;
  // A role-less node has the implicit role `generic`, which takes no state at
  // all; anything set on it is invalid rather than merely unheard.
  if (state.selected !== undefined && role) {
    if (CHECKABLE_ROLES.has(role)) web["aria-checked"] = state.selected;
    else if (SELECTABLE_ROLES.has(role)) web["aria-selected"] = state.selected;
    // Everything else is a toggle button, and pressed is what a button carries.
    else web["accessibilityPressed"] = state.selected;
  }
  return props;
}

/** A continuous control's current position, on both React Native and the DOM. */
export function a11yValue(v: {
  min: number;
  max: number;
  now: number;
  text: string;
}): AccessibilityProps {
  const props: AccessibilityProps = { accessibilityValue: v };
  if (!isWeb) return props;

  const web = props as Record<string, unknown>;
  web["aria-valuemin"] = v.min;
  web["aria-valuemax"] = v.max;
  web["aria-valuenow"] = v.now;
  web["aria-valuetext"] = v.text;
  return props;
}

/**
 * Names a layer as a dialog. Web only, and deliberately without `aria-modal`:
 * that marks everything outside the dialog inert to assistive technology, and
 * a layer whose own close control sits outside its box would go with it.
 */
export function a11yDialog(label: string): AccessibilityProps {
  if (!isWeb) return {};
  return { role: "dialog", "aria-label": label } as AccessibilityProps;
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
 * A control's hint. `props` goes on the control, `node` beside it — the DOM
 * carries a description only by reference, so the text has to exist somewhere.
 * react-native-web's `Switch` spreads unknown props onto its wrapper rather
 * than the focusable input, so there the hint reaches native only.
 */
export function useA11yHint(hint: string | undefined): {
  props: AccessibilityProps;
  node: React.ReactNode;
} {
  const id = useId();
  if (!hint) return { props: {}, node: null };
  const props: AccessibilityProps = { accessibilityHint: hint };
  if (isWeb) (props as Record<string, unknown>)["aria-describedby"] = id;
  return {
    props,
    node: isWeb ? (
      <Text nativeID={id} style={styles.srOnly}>
        {hint}
      </Text>
    ) : null,
  };
}

/** What a keyboard can land on, as react-native-web renders this app. */
const FOCUSABLE = 'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])';
/** A react-native-web `Modal`, which brings a focus trap of its own. */
const MODAL_DIALOG = '[role="dialog"][aria-modal="true"]';

/**
 * Keeps Tab inside the subtrees carrying `testIDs` for as long as the caller
 * is mounted. React Native's `Modal` buys this on web for free
 * (exports/Modal/ModalFocusTrap.js); a layer that deliberately is not one has
 * to carry it itself. A phone has no Tab key, so there is nothing to trap.
 */
export function useFocusTrap(testIDs: string[]) {
  const within = testIDs.map((id) => `[data-testid="${id}"]`).join(",");
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      // A Modal that opened over the trapped layer traps focus itself, and two
      // traps on one keypress drag focus back under the dialog on top.
      const above = Array.from(document.querySelectorAll(MODAL_DIALOG));
      if (above.some((el) => el.closest(within) === null)) return;
      const stops = Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.closest(within) !== null && !el.hasAttribute("disabled")
      );
      if (stops.length === 0) return;
      const at = stops.indexOf(document.activeElement as HTMLElement);
      // Focus outside the trap stands before the first stop, so Tab enters at
      // the top of the order and Shift+Tab at the bottom.
      const next =
        at === -1
          ? e.shiftKey
            ? stops.length - 1
            : 0
          : (at + (e.shiftKey ? -1 : 1) + stops.length) % stops.length;
      e.preventDefault();
      stops[next]?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [within]);
}

/**
 * A live status sentence for a container that cannot be `accessible` itself
 * without collapsing its controls into one unreachable leaf. Its *text* names
 * it, which a bare `aria-label` on a role-less `<div>` does not: that role is
 * `generic`, for which a name is prohibited.
 */
export function A11yStatus({ label }: { label: string }) {
  return (
    <Text
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
      {...(isWeb ? { "aria-live": "polite" as const } : { accessibilityLiveRegion: "polite" as const })}
      style={styles.srOnly}
    >
      {label}
    </Text>
  );
}

// One pixel, out of flow, all but transparent. iOS drops a view with alpha 0
// from the accessibility hierarchy exactly as it drops `display: none`, so the
// opacity has to stay above zero for the node to exist at all.
const SR_ONLY_SIZE = 1;
const SR_ONLY_OPACITY = 0.01;

const styles = StyleSheet.create({
  srOnly: {
    position: "absolute",
    width: SR_ONLY_SIZE,
    height: SR_ONLY_SIZE,
    overflow: "hidden",
    opacity: SR_ONLY_OPACITY,
  },
});
