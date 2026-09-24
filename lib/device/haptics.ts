import * as Haptics from "expo-haptics";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SETTINGS_KEY } from "../storageKeys.ts";
import { traceOnset } from "../e2eTrace.ts";

// expo-haptics' web shim calls navigator.vibrate() per style, a no-op where
// the Vibration API doesn't exist (iOS/desktop Safari) and real on Android
// web — so every platform but nothing-at-all goes through this gate.
const isHapticsPlatform =
  Platform.OS === "ios" || Platform.OS === "android" || Platform.OS === "web";
let _hapticsEnabled = true;

// Same key/shape as SettingsContext — read once at module init so the stored
// preference is honoured even before SettingsProvider has mounted and pushed it.
if (isHapticsPlatform) {
  AsyncStorage.getItem(SETTINGS_KEY)
    .then((raw) => {
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.hapticsEnabled === "boolean") {
          _hapticsEnabled = parsed.hapticsEnabled;
        }
      } catch {}
    })
    .catch(() => {});
}

export function setHapticsMasterEnabled(v: boolean) {
  _hapticsEnabled = v;
}

export function hapticsEnabled(): boolean {
  return _hapticsEnabled;
}

const fire = (name: string, run: () => Promise<void>) => {
  traceOnset("haptic", name);
  return _hapticsEnabled && isHapticsPlatform && run();
};

export const hapticSelection = () => fire("hapticSelection", () => Haptics.selectionAsync());
export const hapticLight = () =>
  fire("hapticLight", () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
export const hapticMedium = () =>
  fire("hapticMedium", () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
export const hapticHeavy = () =>
  fire("hapticHeavy", () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy));
export const hapticRigid = () =>
  fire("hapticRigid", () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid));
export const hapticSuccess = () =>
  fire("hapticSuccess", () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
export const hapticError = () =>
  fire("hapticError", () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
export const hapticWarn = () =>
  fire("hapticWarn", () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
