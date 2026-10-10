import React from "react";
import { StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { CardGloss, withAlpha } from "@/lib/theme";
import { a11yHidden } from "@/lib/a11y";
import { cardGloss, glossSpot } from "./cardGloss";
import { useCardTable, type CardTable, type OwnedRects } from "./useCardRects";

export const GLOSS_SPOT_ART = () => require("../../assets/images/cards/gloss_spot.webp") as number;

const STREAK = [withAlpha(CardGloss.streak.color, 0), CardGloss.streak.color, withAlpha(CardGloss.streak.color, 0)] as const;

interface Props {
  /** The card's key in its publisher's own rects (`useCardRect`, `useStaticCardRects`); either missing draws nothing, as off the table. */
  rectKey: string | undefined;
  rects: OwnedRects | undefined;
  width: number;
  height: number;
}

/** The lamp's spot and streak on one card, read from its own rect and the lamp on the UI thread: the card never re-renders for it. */
export function LampGloss({ rectKey, rects, width, height }: Props) {
  const table = useCardTable();
  if (!table || !rectKey || !rects) return null;
  return <Lit table={table} rectKey={rectKey} rects={rects} width={width} height={height} />;
}

function Lit({ table, rectKey, rects, width, height }: Props & { table: CardTable; rectKey: string; rects: OwnedRects }) {
  const { glossLight: light, felt } = table;
  const s = felt.s;
  const radius = CardGloss.spot.radius * s;
  const diag = Math.hypot(width, height);
  const bandW = 2 * diag;
  const bandH = CardGloss.streak.width * diag;

  const spotStyle = useAnimatedStyle(() => {
    const rect = rects.value[rectKey];
    if (!rect) return { opacity: 0, transform: [{ translateX: 0 }, { translateY: 0 }] };
    const g = glossSpot(rect.x, rect.y, width / s, height / s, light.value);
    return { opacity: g.spotAlpha, transform: [{ translateX: g.spot.x * s }, { translateY: g.spot.y * s }] };
  });
  const streakStyle = useAnimatedStyle(() => {
    const rect = rects.value[rectKey];
    if (!rect) return { opacity: 0, transform: [{ translateX: 0 }, { translateY: 0 }, { rotate: "0rad" }] };
    const g = cardGloss(rect.x, rect.y, width / s, height / s, light.value);
    return { opacity: g.a, transform: [{ translateX: g.band.x * s }, { translateY: g.band.y * s }, { rotate: `${g.ang}rad` }] };
  });

  return (
    <View testID="card-gloss" pointerEvents="none" style={StyleSheet.absoluteFill} {...a11yHidden()}>
      <Animated.Image
        testID="card-gloss-spot"
        source={GLOSS_SPOT_ART()}
        style={[styles.layer, { left: -radius, top: -radius, width: 2 * radius, height: 2 * radius }, spotStyle]}
      />
      <Animated.View testID="card-gloss-streak" pointerEvents="none" style={[styles.layer, { left: (width - bandW) / 2, top: (height - bandH) / 2, width: bandW, height: bandH }, streakStyle]}>
        <LinearGradient colors={STREAK} style={StyleSheet.absoluteFill} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: "absolute" },
});
