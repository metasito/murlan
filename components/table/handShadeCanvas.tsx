// The share of each hand card's shadow that falls on the cards under it (#1466): the felt draws
// every shadow beneath all cards, so this second canvas lies over the table. On web it is only
// ever reached through `handShade.web.tsx`'s lazy boundary, once CanvasKit has loaded.
import { useEffect, useMemo } from "react";
import { StyleSheet } from "react-native";
import { BlurStyle, Canvas, ClipOp, Picture, Skia, type SkPath, type SkPicture } from "@shopify/react-native-skia";
import { useAnimatedReaction, useSharedValue } from "react-native-reanimated";
import { CardShadow, Colors, withAlpha } from "@/lib/theme";
import { addOutline, handShadeCards, handShadeShape, handShades, shadowFall, shadowPaint, type ShadowPath } from "./cardShadows";
import { useCardShadowsOn, type HandShadeProps } from "./feltReady";
import { DISPOSE_PATHS, disposeAfterReactions } from "./skiaDispose";

interface Shade { caster: SkPath; below: SkPath; above: SkPath; back: boolean }

const PAINTS: readonly ShadowPath[] = ["cast", "face", "back"];

export function HandShadeCanvas({ lamp, cards, ready }: HandShadeProps) {
  const { rects, handOrder, motion, felt } = cards;
  const midX = cards.hand.x;
  const pile = { x: cards.pile.x / felt.sx, y: cards.pile.y / felt.sy };
  const recorder = useMemo(() => Skia.PictureRecorder(), []);
  const builder = useMemo(() => Skia.PathBuilder.Make(), []);
  const blurs = useMemo(
    () =>
      PAINTS.map((kind) => {
        const { sigma, alpha } = shadowPaint(kind, felt.s);
        const paint = Skia.Paint();
        const blur = Skia.MaskFilter.MakeBlur(BlurStyle.Normal, sigma, true);
        paint.setAntiAlias(true);
        paint.setColor(Skia.Color(withAlpha(Colors.shadow, alpha)));
        paint.setMaskFilter(blur);
        return { paint, blur };
      }),
    [felt.s]
  );
  const [cast, face, back] = blurs.map(({ paint }) => paint);
  useEffect(
    () => () =>
      disposeAfterReactions(() => {
        for (const { paint, blur } of blurs) {
          paint.dispose();
          blur.dispose();
        }
      }),
    [blurs]
  );
  const empty = useMemo(() => {
    recorder.beginRecording();
    return recorder.finishRecordingAsPicture();
  }, [recorder]);
  const shades = useSharedValue<Shade[]>([]);
  const version = useSharedValue(0);
  const last = useSharedValue("");
  const drawn = useSharedValue<SkPicture>(empty);

  useAnimatedReaction(
    () => [rects.value, handOrder.value] as const,
    ([all, order]) => {
      const read = handShadeCards(all, order, felt);
      const shape = handShadeShape(all, read, felt, midX);
      if (shape === last.value) return;
      last.value = shape;
      const outline = (keys: readonly string[]) => {
        builder.reset();
        for (const key of keys) addOutline(builder, all[key], felt, midX);
        return builder.build();
      };
      const old = shades.value;
      shades.value = handShades(read).map((s) => ({ caster: outline([s.caster]), below: outline(s.below), above: outline(s.above), back: all[s.caster].back }));
      version.value += 1;
      if (DISPOSE_PATHS) for (const s of old) for (const path of [s.caster, s.below, s.above]) path.dispose();
    },
    [builder, felt, midX]
  );

  // Redrawn as the lamp moves, from paths rebuilt only when a card's outline or the paint order changes.
  useAnimatedReaction(
    () => [lamp.value.lx, lamp.value.ly, motion.value, version.value] as const,
    ([lx, ly, m]) => {
      const all = shades.value;
      const prev = drawn.value;
      if (all.length === 0) {
        if (prev === empty) return;
        drawn.value = empty;
        if (DISPOSE_PATHS) prev.dispose();
        return;
      }
      const fall = shadowFall("cast", pile, { x: lx, y: ly });
      const canvas = recorder.beginRecording();
      // The outlines are where the cards are drawn, kicked and shaken; this canvas rides the kick itself.
      canvas.translate(felt.kickAt.x, felt.kickAt.y);
      canvas.scale(1 / m.ks, 1 / m.ks);
      canvas.translate(-felt.kickAt.x - m.kx, -felt.kickAt.y - m.ky);
      for (const s of all) {
        canvas.save();
        canvas.clipPath(s.below, ClipOp.Intersect, true);
        canvas.clipPath(s.above, ClipOp.Difference, true);
        canvas.save();
        canvas.translate(fall.x * felt.s, fall.y * felt.s);
        canvas.drawPath(s.caster, cast);
        canvas.restore();
        canvas.translate(0, CardShadow.contact.y * felt.s);
        canvas.drawPath(s.caster, s.back ? back : face);
        canvas.restore();
      }
      drawn.value = recorder.finishRecordingAsPicture();
      if (DISPOSE_PATHS && prev !== empty) prev.dispose();
    },
    [recorder, cast, face, back, felt, pile.x, pile.y, empty]
  );

  useEffect(
    () => () =>
      disposeAfterReactions(() => {
        if (drawn.value !== empty) drawn.value.dispose();
        for (const s of shades.value) for (const path of [s.caster, s.below, s.above]) path.dispose();
        empty.dispose();
        builder.dispose();
        recorder.dispose();
      }),
    [recorder, builder, drawn, empty, shades]
  );

  const shadows = useCardShadowsOn();
  return (
    <Canvas style={StyleSheet.absoluteFill} testID="hand-shade-skia" pointerEvents="none">
      {shadows && ready && <Picture picture={drawn} />}
    </Canvas>
  );
}
