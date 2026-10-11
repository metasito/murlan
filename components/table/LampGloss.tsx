import React from "react";
import { StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useDerivedValue, type SharedValue } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { CardBacks, CardGloss, Layer, Scrim, withAlpha } from "@/lib/theme";
import { a11yHidden } from "@/lib/a11y";
import type { CardBackId } from "@/lib/cosmetics";
import { cardRadius } from "@/components/cardFaceModel";
import { cardGloss, foilGlint, foilGlintColor, glossSpot, type GlossLight } from "./cardGloss";
import type { CardScope } from "./cardRects";
import { FoilMask } from "./FoilMask";
import { levelShade } from "./rail";
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

export const FOIL_ART: Record<CardBackId, () => number> = {
  smeraldo:   () => require("../../assets/images/cards/foil_smeraldo.webp") as number,
  oro:        () => require("../../assets/images/cards/foil_oro.webp") as number,
  rubino:     () => require("../../assets/images/cards/foil_rubino.webp") as number,
  zaffiro:    () => require("../../assets/images/cards/foil_zaffiro.webp") as number,
  inchiostro: () => require("../../assets/images/cards/foil_inchiostro.webp") as number,
};

/** A back's foil glint: the lamp's band over the back's foil ink alone. */
export function FoilGlint({ backKey, ...props }: Props & { backKey: CardBackId }) {
  const table = useCardTable();
  if (!table || !props.rectKey || !props.rects) return null;
  return (
    <FoilMask art={FOIL_ART[backKey]()}>
      <Glint table={table} rectKey={props.rectKey} rects={props.rects} width={props.width} height={props.height} color={foilGlintColor(CardBacks[backKey].ink)} />
    </FoilMask>
  );
}

function Glint({ table, rectKey, rects, width, height, color }: Omit<Props, "rectKey" | "rects"> & { table: CardTable; rectKey: string; rects: OwnedRects; color: string }) {
  const { glossLight: light, felt } = table;
  const s = felt.s;
  const diag = Math.hypot(width, height);
  const bandW = 2 * diag;
  const bandH = CardGloss.foil.width * diag;

  const glint = useDerivedValue(() => {
    const rect = rects.value[rectKey];
    return rect ? foilGlint(rect.x, rect.y, rect.rot, width / s, height / s, light.value) : null;
  });
  const inkStyle = useAnimatedStyle(() => ({ opacity: glint.value?.edge ?? 0 }));
  const bandStyle = useAnimatedStyle(() => {
    const g = glint.value;
    if (!g) return { opacity: 0, transform: [{ translateX: 0 }, { translateY: 0 }, { rotate: "0rad" }] };
    return {
      opacity: (g.peak - g.edge) / (1 - g.edge),
      transform: [{ translateX: g.band.x * s }, { translateY: g.band.y * s }, { rotate: `${g.ang}rad` }],
    };
  });

  return (
    <>
      <Animated.View testID="card-foil-ink" pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: color }, inkStyle]} />
      <Animated.View testID="card-foil-band" pointerEvents="none" style={[styles.layer, { left: (width - bandW) / 2, top: (height - bandH) / 2, width: bandW, height: bandH }, bandStyle]}>
        <LinearGradient colors={[withAlpha(color, 0), color, withAlpha(color, 0)]} style={StyleSheet.absoluteFill} />
      </Animated.View>
    </>
  );
}

const LIT_SCOPES: readonly CardScope[] = ["hand", "fan", "pile"];

/** The lamp's level over a hand, fan or pile card, a play still flying to the pile included; a deal or exchange flight (`deal`, `leg`) stays bright, as the mockup's `#fly` above its `#shade`. */
export function LevelShade({ rectKey, rects, width, height }: Props) {
  const table = useCardTable();
  if (!table || !rectKey || !rects || !LIT_SCOPES.includes(rectKey.split(":")[0] as CardScope)) return null;
  return <Shade light={table.glossLight} width={width} height={height} />;
}

function Shade({ light, width, height }: { light: SharedValue<GlossLight>; width: number; height: number }) {
  const style = useAnimatedStyle(() => ({ opacity: levelShade(light.value.level) }));
  return (
    <Animated.View
      testID="card-level-shade"
      pointerEvents="none"
      style={[styles.shade, { width, height, borderRadius: cardRadius(width) }, style]}
      {...a11yHidden()}
    />
  );
}

const styles = StyleSheet.create({
  layer: { position: "absolute" },
  shade: { position: "absolute", left: 0, top: 0, zIndex: Layer.levelShade, backgroundColor: Scrim.solid },
});
