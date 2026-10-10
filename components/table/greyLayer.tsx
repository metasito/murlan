import { useState } from "react";
import { Platform } from "react-native";
import { ColorMatrix, Paint } from "@shopify/react-native-skia";
import { useAnimatedReaction, useDerivedValue, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { GREY_VISIBLE, greyMatrix } from "./linkGrey";

const IOS = Platform.OS === "ios";

/** A Skia canvas's `layer` greying it on iOS, where the view filter is not; mounted only while grey shows, as a layer is an offscreen pass on every frame. */
export function useGreyLayer(grey: SharedValue<number> | undefined) {
  const [on, setOn] = useState(() => IOS && grey !== undefined && grey.get() > GREY_VISIBLE);
  useAnimatedReaction(
    () => IOS && grey !== undefined && grey.value > GREY_VISIBLE,
    (now, before) => {
      if (now !== before) scheduleOnRN(setOn, now);
    }
  );
  const matrix = useDerivedValue(() => greyMatrix(grey?.value ?? 0));
  return on ? (
    <Paint>
      <ColorMatrix matrix={matrix} />
    </Paint>
  ) : undefined;
}
