// The native particle layer: one Skia <Atlas> over the felt, its simulation stepped on the UI
// thread in one frame callback. The web's is `particleLayer.web.tsx`.
import { useCallback, useEffect, useImperativeHandle, useState, type Ref } from "react";
import { StyleSheet } from "react-native";
import {
  Atlas,
  BlurStyle,
  Canvas,
  Group,
  Oval,
  PaintStyle,
  rect,
  Skia,
  StrokeCap,
  TileMode,
  useColorBuffer,
  useRectBuffer,
  useRSXformBuffer,
  type SkImage,
} from "@shopify/react-native-skia";
import { useDerivedValue, useFrameCallback, useSharedValue, type FrameInfo, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { traceOnset, useTraceSource } from "@/lib/e2eTrace";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { RestAir } from "@/lib/tokens";
import { createAir, mothPose, MOTES, stepAir, type Air, type MothPose } from "./air";
import type { Lamp } from "./lampRig";
import type { LampRig } from "./useLampRig";
import { createParticles, landDust, landingDustCount, PARTICLE_BUDGET, spawn, step, type ParticleEmitter, type Particles } from "./particles";
import { useLandingReaction } from "./useLandingReaction";
import type { LandingSignal } from "./useFlightClock";
import { CELLS, D, DRAW_STRIDE, layout, layoutMotes, SHEET, SPARK_LEN, SPRITE_R } from "./particleSprites";

interface Field {
  s: Particles;
  d: Float32Array;
  air: Air;
  lit: number;
}

function bakeSheet(): SkImage | null {
  const surface = Skia.Surface.Make(SHEET.width, SHEET.height);
  if (!surface) return null;
  const canvas = surface.getCanvas();
  const white = Skia.Color("white");
  for (const cell of CELLS) {
    const x = cell.x + cell.cx;
    const y = cell.y + cell.cy;
    // A canvas `shadowBlur` of b is a Gaussian of sigma b/2 under the crisp shape.
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

// `moth` is written only while one flies: `field` changes every frame, and shapes derived from it would rebuild with it.
function stepper(field: SharedValue<Field>, lamp: SharedValue<Lamp>, still: SharedValue<boolean>, moth: SharedValue<MothPose | null>) {
  return (frame: FrameInfo) => {
    "worklet";
    const v = field.value;
    const l = lamp.value;
    const dt = Math.min(0.05, (frame.timeSincePreviousFrame ?? 0) / 1000);
    step(v.s, dt);
    if (stepAir(v.air, dt, l.freeze, still.value, Math.random)) scheduleOnRN(traceOnset, "moment", "moth");
    layout(v.s, v.d);
    v.lit = layoutMotes(v.air, l, v.d, v.s.live);
    const p = mothPose(v.air, l);
    if (p || moth.value) moth.value = p;
    field.modify(undefined, true);
  };
}

const ovalOf = (cx: number, cy: number, rx: number, ry: number) => {
  "worklet";
  return rect(cx - rx, cy - ry, 2 * rx, 2 * ry);
};

const wingOf = (p: MothPose | null, side: number) => {
  "worklet";
  return p ? ovalOf(p.mx + side * p.wing, p.my, p.wing, p.wingRy) : ovalOf(0, 0, 0, 0);
};

export function ParticleLayer({ ref, rig, landing }: {
  ref?: Ref<ParticleEmitter>;
  rig: Pick<LampRig, "lamp" | "sx" | "sy">;
  /** The landing dust is thrown on the contact frame, on this thread. */
  landing: SharedValue<LandingSignal>;
}) {
  const { lamp, sx, sy } = rig;
  const [sheet] = useState(bakeSheet);
  const field = useSharedValue<Field>({
    s: createParticles(),
    d: new Float32Array(PARTICLE_BUDGET * DRAW_STRIDE),
    air: createAir(Math.random),
    lit: 0,
  });
  const moth = useSharedValue<MothPose | null>(null);
  const reduced = usePrefersReducedMotion();
  const still = useSharedValue(reduced);
  useEffect(() => {
    still.value = reduced;
  }, [reduced, still]);
  useLandingReaction(landing, (l) => {
    "worklet";
    if (reduced) return;
    field.modify((v) => {
      "worklet";
      for (const p of landDust(l.cards, landingDustCount(l.cards), l.x / sx, l.y / sy, Math.random)) spawn(v.s, p);
      return v;
    }, true);
  });

  // The compiler drops a `useCallback` around a worklet — useLampRig.ts.
  const [onFrame] = useState(() => stepper(field, lamp, still, moth));
  useFrameCallback(onFrame);
  useTraceSource("live", useCallback(() => field.value.s.live + MOTES, [field]));
  useTraceSource("dropped", useCallback(() => field.value.s.dropped, [field]));
  useTraceSource("motes", useCallback(() => field.value.lit, [field]));
  useTraceSource(
    "moth",
    useCallback(() => {
      const p = moth.value;
      return p && { x: p.mx * sx, y: p.my * sy };
    }, [moth, sx, sy])
  );

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
    if (i < s.live + MOTES) r.setXYWH(d[o + D.x], d[o + D.y], d[o + D.w], d[o + D.h]);
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
    c[3] = i < s.live + MOTES ? d[o + D.a] : 0;
  });
  const shadow = useDerivedValue(() => {
    const p = moth.value;
    return p ? ovalOf(0, 0, p.shadowRx, p.shadowRy) : ovalOf(0, 0, 0, 0);
  });
  const shadowAt = useDerivedValue(() => {
    const p = moth.value;
    return p ? [{ translateX: p.sx }, { translateY: p.sy }, { rotate: p.shadowRot }] : [];
  });
  const leftWing = useDerivedValue(() => wingOf(moth.value, -1));
  const rightWing = useDerivedValue(() => wingOf(moth.value, 1));

  if (!sheet) return null;
  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Group transform={[{ scaleX: sx }, { scaleY: sy }]}>
        <Atlas image={sheet} sprites={sprites} transforms={transforms} colors={colors} colorBlendMode="modulate" />
        <Group transform={shadowAt}>
          <Oval rect={shadow} color={RestAir.mothShadow} />
        </Group>
        <Oval rect={leftWing} color={RestAir.moth} />
        <Oval rect={rightWing} color={RestAir.moth} />
      </Group>
    </Canvas>
  );
}
