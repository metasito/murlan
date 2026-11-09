import { Component, useEffect, useState, type ReactNode } from "react";
import { View } from "react-native";
import { Canvas, Fill, Shader, Skia } from "@shopify/react-native-skia";
import Animated, { useDerivedValue, useFrameCallback, useSharedValue } from "react-native-reanimated";
import { css, cubicBezier } from "react-native-reanimated";
import { diag } from "@/lib/diagnostics";
import { keyframes, keyframesVariant, LOOP_SECONDS } from "./swayTable";

const W = 874;
const H = 402;
const EASE = cubicBezier(0.445, 0.05, 0.55, 0.95);
const FRAMES = keyframes(EASE);
const MEMO = css.keyframes(FRAMES as never);
const NO_EASE = keyframesVariant("noEase", EASE);
const SHORT = keyframesVariant("short", EASE);
const ANIM = {
  full: { name: FRAMES, seconds: LOOP_SECONDS },
  memo: { name: MEMO, seconds: LOOP_SECONDS },
  noEase: { name: NO_EASE.frames, seconds: NO_EASE.seconds },
  short: { name: SHORT.frames, seconds: SHORT.seconds },
} as const;

export type SpikeConfig = {
  layers: 1 | 2;
  driver: "static" | "css" | "paused";
  opaqueB: boolean;
  pool: "none" | "g2" | "g1";
  offset: number;
  anim?: keyof typeof ANIM;
};

const NOISE = Skia.RuntimeEffect.Make(`
uniform float2 size; uniform float seed;
half4 main(float2 xy) {
  float2 p = xy / size;
  float v = fract(sin(dot(xy, float2(12.9898, 78.233)) + seed) * 43758.5453);
  return half4(0.1 + 0.2 * v * p.x, 0.3 + 0.4 * v, 0.15 + 0.2 * v * p.y, 1.0);
}`)!;

const LIT = Skia.RuntimeEffect.Make(`
uniform float2 size; uniform float2 lamp; uniform float R;
half4 main(float2 xy) {
  float2 d = xy - lamp;
  float r = length(d);
  float3 l = normalize(float3(-d, R * 0.4));
  float n = fract(sin(dot(xy, float2(12.9898, 78.233))) * 43758.5453);
  float diff = max(0.0, dot(normalize(float3((n - 0.5) * 0.4, (n - 0.5) * 0.3, 1.0)), l));
  float pool = pow(clamp(1.0 - r / R, 0.0, 1.0), 1.6);
  return half4(half3(0.12, 0.36, 0.2) * (0.5 + diff * pool) + half3(0.3, 0.2, 0.1) * pool, 1.0);
}`)!;

function Noise({ seed, opaque }: { seed: number; opaque: boolean }) {
  return (
    <Canvas opaque={opaque} style={{ position: "absolute", left: 0, top: 0, width: W, height: H }}>
      <Fill>
        <Shader source={NOISE} uniforms={{ size: [W, H], seed }} />
      </Fill>
    </Canvas>
  );
}

function LiveLit() {
  const lamp = useSharedValue([W / 2, H * 0.6]);
  const t = useSharedValue(0);
  useFrameCallback((f) => {
    "worklet";
    t.value += (f.timeSincePreviousFrame ?? 16) / 1000;
    lamp.value = [W / 2 + Math.sin(t.value * 0.84) * 100, H * 0.6];
  });
  const uniforms = useDerivedValue(() => ({ size: [W, H], lamp: lamp.value, R: 380 }));
  return (
    <Canvas opaque style={{ position: "absolute", left: 0, top: 0, width: W, height: H }}>
      <Fill>
        <Shader source={LIT} uniforms={uniforms} />
      </Fill>
    </Canvas>
  );
}

class Guard extends Component<{ label: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    diag({ k: "crash", t: performance.now(), message: `${this.props.label}: ${error.message}` });
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function SwaySpikeNative({ config }: { config: SpikeConfig }) {
  return (
    <Guard key={JSON.stringify(config)} label={JSON.stringify(config)}>
      <Scene config={config} />
    </Guard>
  );
}

function Scene({ config }: { config: SpikeConfig }) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready) return null;
  const css = config.driver !== "static";
  return (
    <View style={{ width: W, height: H, backgroundColor: "#000", overflow: "hidden" }}>
      {config.pool === "g1" ? <LiveLit /> : <Noise seed={1} opaque />}
      {config.layers === 2 ? (
        <Animated.View
          style={
            [
              { position: "absolute", left: 0, top: 0, width: W, height: H, opacity: config.driver === "static" ? 0.5 : undefined },
              css && {
                animationName: ANIM[config.anim ?? "full"].name,
                animationDuration: `${ANIM[config.anim ?? "full"].seconds}s`,
                animationIterationCount: "infinite",
                animationTimingFunction: "linear",
                animationDelay: `${-config.offset}s`,
                animationPlayState: config.driver === "paused" ? "paused" : "running",
              },
            ] as never
          }
        >
          <Noise seed={2} opaque={config.opaqueB} />
        </Animated.View>
      ) : null}
      {config.pool === "g2" ? (
        <Animated.View
          style={
            {
              position: "absolute",
              left: 0,
              top: 0,
              width: 760,
              height: 760,
              borderRadius: 380,
              backgroundColor: "rgba(255,220,160,0.5)",
              mixBlendMode: "plus-lighter",
              animationName: { from: { transform: [{ translateX: -300 }, { translateY: -150 }] }, to: { transform: [{ translateX: 200 }, { translateY: -100 }] } },
              animationDuration: "2s",
              animationIterationCount: "infinite",
              animationDirection: "alternate",
              animationTimingFunction: "ease-out",
            } as never
          }
        />
      ) : null}
    </View>
  );
}
