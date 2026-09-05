import * as Haptics from "expo-haptics";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

// expo-haptics' web shim calls navigator.vibrate() per style, a no-op where
// the Vibration API doesn't exist (iOS/desktop Safari) and real on Android
// web — so every platform but nothing-at-all goes through this gate.
const isHapticsPlatform =
  Platform.OS === "ios" || Platform.OS === "android" || Platform.OS === "web";
let _hapticsEnabled = true;

// Same key/shape as SettingsContext — read once at module init so the stored
// preference is honoured even before SettingsProvider has mounted and pushed it.
const SETTINGS_STORAGE_KEY = "@murlan_settings";
if (isHapticsPlatform) {
  AsyncStorage.getItem(SETTINGS_STORAGE_KEY)
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

const guard = () => _hapticsEnabled && isHapticsPlatform;

export const hapticSelection = () => guard() && Haptics.selectionAsync();
export const hapticLight = () =>
  guard() && Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
export const hapticMedium = () =>
  guard() && Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
export const hapticHeavy = () =>
  guard() && Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
export const hapticSuccess = () =>
  guard() && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
export const hapticError = () =>
  guard() && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
export const hapticWarn = () =>
  guard() && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
