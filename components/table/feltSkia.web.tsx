// CanvasKit stays out of the web first load (docs/BUNDLE.md): the boundary that loads it is its
// own chunk, mounted a frame after the table has painted, and the fallback holds the felt until
// Skia has drawn — or for good, where WebGL is drawn on the CPU.
import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { FeltFallback } from "./feltFallback";
import { useFeltReady, type FeltProps } from "./feltReady";
import { levelShade } from "./rail";

const SkiaFelt = lazy(() => import("./feltSkiaBoundary"));

const SOFTWARE_GL = /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i;

/** The felt's shader covers the table: on a software rasteriser a swaying lamp takes the main thread. */
function drawsOnGpu(): boolean {
  const e2e = globalThis as { murlanSkiaOnSoftware?: boolean };
  if (process.env.EXPO_PUBLIC_E2E_FAST === "1" && e2e.murlanSkiaOnSoftware) return true;
  const gl = document.createElement("canvas").getContext("webgl", { failIfMajorPerformanceCaveat: true });
  if (!gl) return false;
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return !SOFTWARE_GL.test(renderer);
}

/** CanvasKit is fetched from jsDelivr: when that fails, the fallback felt stays and the table plays on. */
export class SkiaLoadFailed extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function Felt({ rig, stops, target }: FeltProps) {
  const [painted, setPainted] = useState(false);
  const [gpu] = useState(drawsOnGpu);
  const [ready, onReady] = useFeltReady();
  const shadeStyle = useAnimatedStyle(() => ({ opacity: levelShade(rig.lamp.value.level) }));

  useEffect(() => {
    const id = requestAnimationFrame(() => setPainted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {!ready && <FeltFallback stops={stops} target={target} sx={rig.sx} sy={rig.sy} />}
      {!ready && <Animated.View testID="felt-level-shade" style={[StyleSheet.absoluteFill, styles.shade, shadeStyle]} />}
      {painted && gpu && (
        <SkiaLoadFailed>
          <Suspense fallback={null}>
            <SkiaFelt lamp={rig.lamp} sx={rig.sx} sy={rig.sy} stops={stops} onReady={onReady} />
          </Suspense>
        </SkiaLoadFailed>
      )}
    </View>
  );
}

const styles = StyleSheet.create({ shade: { backgroundColor: "black" } });
