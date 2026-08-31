import { Platform } from "react-native";

/**
 * What a `KeyboardAvoidingView` should do about the IME, given whether the
 * content inside it already moves the focused field itself.
 *
 * Android is always `padding`. Edge-to-edge has been unconditional since Expo
 * SDK 54, so the framework no longer pads the window for the keyboard and
 * `adjustResize` reflows nothing on its own — the view has to read the keyboard
 * events.
 *
 * iOS depends on what is inside, because two answers to one keyboard event
 * compound rather than agree: a `ScrollView` with
 * `automaticallyAdjustKeyboardInsets` has already moved the field, so the view
 * stands down. `padding` is for the containers that have no such scroller —
 * chiefly modals, which lay themselves out against the window.
 *
 * On web both are inert; the browser scrolls the focused input into view.
 */
export function keyboardBehavior({
  contentAdjustsInsets,
}: {
  contentAdjustsInsets: boolean;
}): "padding" | undefined {
  if (Platform.OS === "ios") return contentAdjustsInsets ? undefined : "padding";
  return "padding";
}
