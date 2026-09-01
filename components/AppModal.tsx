// The app's only <Modal>, which tests/orientation.test.ts pins.
//
// React Native's Modal defaults to `supportedOrientations={["portrait"]}` on
// iOS, so one opened in landscape rotates the whole app and leaves the screen
// underneath laid out for the old size — every tap then lands on nothing.
import React from "react";
import { Modal } from "react-native";
import { usePrefersReducedMotion } from "@/lib/accessibility";

export function AppModal({
  visible = true,
  animation = "fade",
  onRequestClose,
  accessibilityLabel,
  children,
}: {
  visible?: boolean;
  /**
   * `"none"` under reduced motion whatever this says. `"slide"` is for a sheet
   * that arrives from an edge; everything else fades.
   */
  animation?: "fade" | "slide" | "none";
  /**
   * Escape and the Android back gesture. Pass a no-op where there is nothing
   * to close to — omitting it makes a Modal swallow both silently.
   */
  onRequestClose: () => void;
  accessibilityLabel?: string;
  children: React.ReactNode;
}) {
  const reduceMotion = usePrefersReducedMotion();
  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduceMotion ? "none" : animation}
      onRequestClose={onRequestClose}
      statusBarTranslucent
      supportedOrientations={["portrait", "landscape"]}
      accessibilityLabel={accessibilityLabel}
    >
      {children}
    </Modal>
  );
}
