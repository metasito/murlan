// Text inside the table, capped so it cannot outgrow its box.
//
// React Native multiplies every fontSize by the OS text setting — up to ~3.1x
// on iOS's Larger Accessibility Sizes — and leaves width, height and lineHeight
// alone. The table is built entirely from fixed boxes, so the cap is not a
// preference: a bare <Text> in here overflows. Setting it after the spread is
// what makes that structural — a caller cannot pass a larger multiplier in.
import { Text, type TextProps } from "react-native";
import { TABLE_FONT_SCALE_MAX } from "@/lib/theme";

export function TableText(props: TextProps) {
  return <Text {...props} maxFontSizeMultiplier={TABLE_FONT_SCALE_MAX} />;
}
