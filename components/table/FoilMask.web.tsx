import React from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { Asset } from "expo-asset";
import { a11yHidden } from "@/lib/a11y";

/** Its children shown through a back's foil art alone, screened over what lies beneath, as the materials mockup's `drawBack`. */
export function FoilMask({ art, children }: { art: number; children: React.ReactNode }) {
  // react-native-masked-view's web build renders its mask as a plain child and masks nothing.
  return (
    <View testID="card-foil-glint" pointerEvents="none" style={[StyleSheet.absoluteFill, cssMask(art)]} {...a11yHidden()}>
      {children}
    </View>
  );
}

function cssMask(art: number): ViewStyle {
  const image = `url(${Asset.fromModule(art).uri})`;
  return { maskImage: image, maskSize: "100% 100%", maskRepeat: "no-repeat", mixBlendMode: "screen" } as ViewStyle;
}
