import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

const isNative = Platform.OS === "ios" || Platform.OS === "android";
let _hapticsEnabled = true;

export function setHapticsMasterEnabled(v: boolean) {
  _hapticsEnabled = v;
}

const guard = () => _hapticsEnabled && isNative;

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
