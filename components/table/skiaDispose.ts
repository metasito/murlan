import { Platform } from "react-native";
import { scheduleOnUI } from "react-native-worklets";

// CanvasKit frees nothing itself; on native the host object's finalizer does.
export const DISPOSE_PATHS = Platform.OS === "web";

/** On web `stopMapper` waits on the UI queue, so a reaction can still run after an unmount's synchronous cleanup. */
export function disposeAfterReactions(dispose: () => void) {
  if (DISPOSE_PATHS) scheduleOnUI(dispose);
}
