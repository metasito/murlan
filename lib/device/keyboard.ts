import { Platform } from "react-native";

/**
 * What a `KeyboardAvoidingView` should do about the IME.
 *
 * Android is always `padding`: edge-to-edge has been unconditional since Expo
 * SDK 54, so the framework no longer pads the window for the keyboard and
 * `adjustResize` reflows nothing on its own.
 *
 * iOS stands down when a `ScrollView` inside carries
 * `automaticallyAdjustKeyboardInsets` and has already moved the field, and pads
 * for the containers that have no such scroller. On web both are inert.
 */
export function keyboardBehavior({
  contentAdjustsInsets,
}: {
  contentAdjustsInsets: boolean;
}): "padding" | undefined {
  if (Platform.OS === "ios") return contentAdjustsInsets ? undefined : "padding";
  return "padding";
}
