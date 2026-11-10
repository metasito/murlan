// The native particle layer: the rest air (moteLayer) and, only while a burst flies, one Skia <Atlas> over the felt, its
// simulation stepped on the UI thread in one frame callback. The web's is `particleLayer.web.tsx`.
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
import { useSharedValue, type FrameInfo, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { traceOnset, useTraceSource } from "@/lib/e2eTrace";
import { useDuring } from "@/lib/motion";
import { MOTES } from "./air";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import type { Lamp } from "./lampRig";
import type { LampRig } from "./useLampRig";
import { bombFx, landingDust, PARTICLE_BUDGET, spawn, type ParticleEmitter, type ParticleSpawn } from "./particles";
import { MoteLayer } from "./moteLayer";
import { startEmber } from "./ember";
import { startRain } from "./coneRain";
import { useGreyLayer } from "./greyLayer";
import { useLandingReaction } from "./useLandingReaction";
import { useBombBeat } from "./useBombBeat";
import type { LandingSignal } from "./useFlightClock";
import { CELLS, createScene, D, DRAW_STRIDE, sceneIdle, SHEET, SPARK_LEN, SPRITE_R, stepScene, type Scene } from "./particleSprites";

type Field = Scene;

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

function stepper(field: SharedValue<Field>, lamp: SharedValue<Lamp>) {
  return (frame: FrameInfo): boolean => {
    "worklet";
    const v = field.value;
    stepScene(v, lamp.value, Math.min(0.05, (frame.timeSincePreviousFrame ?? 0) / 1000), Math.random);
    field.modify(undefined, true);
    return !sceneIdle(v);
  };
}

function BurstField({ field, sx, sy, sheet, greyLayer }: {
  field: SharedValue<Field>;
  sx: number;
  sy: number;
  sheet: SkImage;
  greyLayer: ReturnType<typeof useGreyLayer>;
}) {
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
  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none" testID="particle-skia">
      <Group transform={[{ scaleX: sx }, { scaleY: sy }]} layer={greyLayer}>
        <Atlas image={sheet} sprites={sprites} transforms={transforms} colors={colors} colorBlendMode="modulate" />
      </Group>
    </Canvas>
  );
}

export function ParticleLayer({ ref, rig, landing, grey }: {
  ref?: Ref<ParticleEmitter>;
  rig: Pick<LampRig, "lamp" | "stillLight" | "sx" | "sy">;
  /** The landing dust is thrown on the contact frame, on this thread. */
  landing: SharedValue<LandingSignal>;
  grey?: SharedValue<number>;
}) {
  const { lamp, sx, sy } = rig;
  const greyLayer = useGreyLayer(grey);
  const [sheet] = useState(bakeSheet);
  const [initial] = useState<Field>(() => createScene());
  const field = useSharedValue(initial);
  const reduced = usePrefersReducedMotion();
  // The compiler drops a `useCallback` around a worklet — useLampRig.ts.
  const [onFrame] = useState(() => stepper(field, lamp));
  // The canvas stays mounted and the frame callback released: a throw wakes it on the contact frame, and it releases itself when nothing flies.
  const wake = useDuring(onFrame, false);
  const throwInto = (spawns: readonly ParticleSpawn[]) => {
    "worklet";
    field.modify((v) => {
      "worklet";
      for (const p of spawns) spawn(v.s, p);
      return v;
    }, true);
    wake();
  };
  useLandingReaction(landing, (l) => {
    "worklet";
    throwInto(landingDust(l, reduced, sx, sy, Math.random));
  });
  useBombBeat(landing, reduced, (l) => {
    "worklet";
    throwInto(bombFx(l, reduced, sx, sy, Math.random));
    scheduleOnRN(traceOnset, "moment", "bombFx");
  });

  useTraceSource("live", useCallback(() => field.value.s.live + MOTES, [field]));
  useTraceSource("dropped", useCallback(() => field.value.s.dropped, [field]));

  useImperativeHandle(ref, () => ({
    emit(spawns) {
      field.modify((v) => {
        "worklet";
        for (const p of spawns) spawn(v.s, p);
        return v;
      }, true);
      wake();
    },
    ember(from, to) {
      if (reduced) return;
      field.modify((v) => {
        "worklet";
        startEmber(v.ember, from, to);
        return v;
      }, true);
      wake();
    },
    rain() {
      if (reduced) return;
      field.modify((v) => {
        "worklet";
        startRain(v.rain);
        return v;
      }, true);
      wake();
    },
  }), [field, reduced, wake]);

  return (
    <>
      <MoteLayer rig={rig} />
      {sheet && <BurstField field={field} sx={sx} sy={sy} sheet={sheet} greyLayer={greyLayer} />}
    </>
  );
}
