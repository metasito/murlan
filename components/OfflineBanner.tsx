import React, { useEffect, useState, useSyncExternalStore } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Layer, Spacing, TOUCH_TARGET_MIN } from "@/lib/theme";
import { a11yHidden } from "@/lib/a11y";
import { cardScale } from "@/components/cardFaceModel";
import { mockupPx } from "@/components/table/noticeModel";
import { OfflinePill } from "@/components/table/notices/hud";

/** G2's `#n-offline`: 13.4 mockup px down, where the turn pill sits on the table. */
const PILL_TOP = 13.4;

export function useDeviceOffline(): boolean {
  const [isOffline, setIsOffline] = useState(false);
  useEffect(
    () =>
      NetInfo.addEventListener((state) => {
        // Only flag offline when definitively false — null/undefined stays online.
        // This exact check is an app invariant — do not change it to `!state.isConnected`.
        const offline = state.isConnected === false;
        setIsOffline(offline);
      }),
    []
  );
  return isOffline;
}

let tables = 0;
const watchers = new Set<() => void>();
const tell = () => watchers.forEach((w) => w());
const watch = (w: () => void) => {
  watchers.add(w);
  return () => {
    watchers.delete(w);
  };
};
const tableOnScreen = () => tables > 0;

/** A table on screen carries the connection in its turn pill (Q8), so the pill off the table yields to it. */
export function useTableClaim() {
  useEffect(() => {
    tables += 1;
    tell();
    return () => {
      tables -= 1;
      tell();
    };
  }, []);
}

/** `overTable`: drawn where no table can carry it, such as the settings sheet opened over one. */
export function OfflineBanner({ overTable = false }: { overTable?: boolean }) {
  const offline = useDeviceOffline();
  const underTable = useSyncExternalStore(watch, tableOnScreen, tableOnScreen);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const scale = cardScale(Math.min(width, height));
  const shown = offline && (overTable || !underTable);
  // G2 drew the pill over a landscape menu only; standing, a menu's corner controls share its row, so it goes under them.
  const top =
    width > height ? insets.top + mockupPx(PILL_TOP, scale) : Math.max(insets.top, Spacing.roomy) + TOUCH_TARGET_MIN + Spacing.sm;
  return (
    <View
      testID="offline-banner"
      pointerEvents="none"
      style={[styles.band, { top }]}
      accessibilityRole="alert"
      accessibilityLiveRegion={shown ? "assertive" : "none"}
      {...a11yHidden(!shown)}
    >
      <OfflinePill scale={scale} shown={shown} />
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: Layer.alert,
    alignItems: "center",
    paddingHorizontal: Spacing.md,
  },
});
