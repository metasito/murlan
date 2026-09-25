// The native particle layer: one Skia <Atlas> over the felt, its simulation stepped on the UI
// thread in one frame callback. The web's is `particleLayer.web.tsx`.
import { useCallback, useImperativeHandle, useState, type Ref } from "react";
import { StyleSheet } from "react-native";
import {
  Atlas,
  BlurStyle,
  Canvas,
  Group,
  PaintStyle,
  Skia,
  StrokeCap,
  TileMode,
  useColorBuffer,
  useRectBuffer,
  useRSXformBuffer,
  type SkImage,
} from "@shopify/react-native-skia";
import { useFrameCallback, useSharedValue, type FrameInfo, type SharedValue } from "react-native-reanimated";
import { useTraceSource } from "@/lib/e2eTrace";
import { createParticles, PARTICLE_BUDGET, spawn, step, type ParticleEmitter, type Particles } from "./particles";
import { CELLS, D, DRAW_STRIDE, layout, SHEET, SPARK_LEN, SPRITE_R } from "./particleSprites";

interface Field {
  s: Particles;
  d: Float32Array;
  shown: number;
}

function bakeSheet(): SkImage | null {
  const surface = Skia.Surface.Make(SHEET.width, SHEET.height);
  if (!surface) return null;
  const canvas = surface.getCanvas();
  const white = Skia.Color("white");
  for (const cell of CELLS) {
    const x = cell.x + cell.cx;
    const y = cell.y + cell.cy;
    // A canvas `shadowBlur` of b is a Gaussian of σ b/2 under the crisp shape.
    for (const sigma of cell.glow ? [(cell.glow * SPRITE_R) / 2, 0] : [0]) {
      const paint = Skia.Paint();
      paint.setAntiAlias(true);
      paint.setColor(white);
      if (sigma) paint.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, sigma, false));
      if (cell.shape === "soft") {
        paint.setShader(
          Skia.Shader.MakeRadialGradient({ x, y }, SPRITE_R, [white, Skia.Color("transparent")], null, TileMode.Clamp)
        );
        canvas.drawRect(Skia.XYWHRect(x - SPRITE_R, y - SPRITE_R, 2 * SPRITE_R, 2 * SPRITE_R), paint);
      } else if (cell.shape === "spark") {
        paint.setStyle(PaintStyle.Stroke);
        paint.setStrokeWidth(2 * SPRITE_R);
        paint.setStrokeCap(StrokeCap.Round);
        canvas.drawLine(x, y, x + SPARK_LEN, y, paint);
      } else {
        canvas.drawCircle(x, y, SPRITE_R, paint);
      }
    }
  }
  return surface.makeImageSnapshot();
}

function stepper(field: SharedValue<Field>) {
  return (frame: FrameInfo) => {
    "worklet";
    const v = field.value;
    if (!v.s.live && !v.shown) return;
    step(v.s, Math.min(0.05, (frame.timeSincePreviousFrame ?? 0) / 1000));
    layout(v.s, v.d);
    v.shown = v.s.live;
    field.modify(undefined, true);
  };
}

export function ParticleLayer({ ref, sx, sy }: { ref: Ref<ParticleEmitter>; sx: number; sy: number }) {
  const [sheet] = useState(bakeSheet);
  const field = useSharedValue<Field>({ s: createParticles(), d: new Float32Array(PARTICLE_BUDGET * DRAW_STRIDE), shown: 0 });

  // The compiler drops a `useCallback` around a worklet — useLampRig.ts.
  const [onFrame] = useState(() => stepper(field));
  useFrameCallback(onFrame);
  useTraceSource("live", useCallback(() => field.value.s.live, [field]));
  useTraceSource("dropped", useCallback(() => field.value.s.dropped, [field]));

  useImperativeHandle(ref, () => ({
    emit(spawns) {
      field.modify((v) => {
        "worklet";
        for (const p of spawns) spawn(v.s, p);
        return v;
      }, true);
    },
  }), [field]);

  const sprites = useRectBuffer(PARTICLE_BUDGET, (r, i) => {
    "worklet";
    const { s, d } = field.value;
    const o = i * DRAW_STRIDE;
    if (i < s.live) r.setXYWH(d[o + D.x], d[o + D.y], d[o + D.w], d[o + D.h]);
    else r.setXYWH(0, 0, 0, 0);
  });
  const transforms = useRSXformBuffer(PARTICLE_BUDGET, (t, i) => {
    "worklet";
    const { d } = field.value;
    const o = i * DRAW_STRIDE;
    t.set(d[o + D.scos], d[o + D.ssin], d[o + D.tx], d[o + D.ty]);
  });
  const colors = useColorBuffer(PARTICLE_BUDGET, (c, i) => {
    "worklet";
    const { s, d } = field.value;
    const o = i * DRAW_STRIDE;
    c[0] = d[o + D.r];
    c[1] = d[o + D.g];
    c[2] = d[o + D.b];
    c[3] = i < s.live ? d[o + D.a] : 0;
  });

  if (!sheet) return null;
  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Group transform={[{ scaleX: sx }, { scaleY: sy }]}>
        <Atlas image={sheet} sprites={sprites} transforms={transforms} colors={colors} colorBlendMode="modulate" />
      </Group>
    </Canvas>
  );
}
