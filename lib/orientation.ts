import { useWindowDimensions } from "react-native";

/**
 * Whether the window is wider than it is tall.
 *
 * Menus lay out both ways and each screen was deriving this itself; the game
 * screens are landscape-locked and ask nothing.
 */
export function useIsLandscape(): boolean {
  const { width, height } = useWindowDimensions();
  return width > height;
}
