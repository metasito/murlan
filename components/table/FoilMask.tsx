import React from "react";
import { Image, StyleSheet, View, type ViewProps } from "react-native";
import MaskedViewUntyped from "@react-native-masked-view/masked-view";
import { a11yHidden } from "@/lib/a11y";
import { ART_FILL } from "@/components/cardFaceModel";

// 0.3.2's types extend React Native's `NativeMethods`, which the Strict TypeScript API no longer exports.
const MaskedView = MaskedViewUntyped as unknown as React.ComponentType<ViewProps & { maskElement: React.ReactElement }>;

/** Its children shown through a back's foil art alone, screened over what lies beneath, as the materials mockup's `drawBack`. */
export function FoilMask({ art, children }: { art: number; children: React.ReactNode }) {
  // `mixBlendMode` is a Fabric View prop and MaskedView a legacy-interop view, so the blend goes on a View around it.
  return (
    <View testID="card-foil-glint" pointerEvents="none" style={[StyleSheet.absoluteFill, styles.screen]} {...a11yHidden()}>
      <MaskedView
        style={StyleSheet.absoluteFill}
        maskElement={<Image source={art} style={ART_FILL} resizeMode="stretch" />}
      >
        {children}
      </MaskedView>
    </View>
  );
}

const styles = StyleSheet.create({ screen: { mixBlendMode: "screen" } });
