import { createContext, useContext, useState, type ReactNode } from "react";
import { View, StyleSheet, useWindowDimensions, type LayoutChangeEvent } from "react-native";

type WindowSize = { width: number; height: number };

/**
 * `null` until a provider is mounted above — a component under test in
 * isolation, most often — falls back to the window instead.
 */
const OrientationContext = createContext<WindowSize | null>(null);

/**
 * Seeds every screen's first render with `useWindowDimensions()`, then
 * overrides it with what the app's own root view actually measures.
 *
 * `Dimensions.get('window')` — what `useWindowDimensions()` reads — is a
 * value iOS hands the bridge once at launch and only replaces on a genuine
 * rotation; on a cold start it can hand over the wrong orientation, and
 * nothing corrects it until the player rotates the device (#819). A
 * `View`'s `onLayout` is not that cache: it is Yoga's own read of the frame
 * actually on screen, so it carries the true orientation from the first
 * layout pass regardless of what the bridge handed over.
 */
export function OrientationProvider({ children }: { children: ReactNode }) {
  const fallback = useWindowDimensions();
  const [measured, setMeasured] = useState<WindowSize | null>(null);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setMeasured((prev) =>
      prev?.width === width && prev?.height === height ? prev : { width, height }
    );
  };

  return (
    <View testID="orientation-root" style={styles.fill} onLayout={onLayout}>
      <OrientationContext.Provider value={measured ?? fallback}>
        {children}
      </OrientationContext.Provider>
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });

/**
 * The window's own size — the provider's measured value once mounted, the
 * raw window before that or with no provider above. Every consumer of
 * `useIsLandscape()` that also needs the raw dimensions reads them from
 * here rather than calling `useWindowDimensions()` a second time: two reads
 * can each self-correct on its own schedule, and the gap between them is a
 * boolean and a set of numbers describing different moments (#821).
 */
export function useOrientedWindow(): WindowSize {
  const ctx = useContext(OrientationContext);
  // Called unconditionally, so this hook's own order never depends on
  // whether a provider happens to be mounted above it.
  const fallback = useWindowDimensions();
  return ctx ?? fallback;
}

/** Whether the window is wider than it is tall. */
export function useIsLandscape(): boolean {
  const { width, height } = useOrientedWindow();
  return width > height;
}
