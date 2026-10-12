import React from "react";
import { Image, StyleSheet, View } from "react-native";
import MaskedView from "@react-native-masked-view/masked-view";
import { a11yHidden } from "@/lib/a11y";
import { ART_FILL } from "@/components/cardFaceModel";

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
