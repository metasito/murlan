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

/** Whether the window is wider than it is tall. */
export function useIsLandscape(): boolean {
  const ctx = useContext(OrientationContext);
  // Called unconditionally, so this hook's own order never depends on
  // whether a provider happens to be mounted above it.
  const fallback = useWindowDimensions();
  const { width, height } = ctx ?? fallback;
  return width > height;
}
