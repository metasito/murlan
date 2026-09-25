// CanvasKit stays out of the web first load (docs/BUNDLE.md): the boundary that loads it is its
// own chunk, mounted a frame after the table has painted, and the fallback holds the felt until
// Skia has drawn.
import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { FeltFallback } from "./feltFallback";
import { useFeltReady, type FeltProps } from "./feltReady";

const SkiaFelt = lazy(() => import("./feltSkiaBoundary"));

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
  const [ready, onReady] = useFeltReady();

  useEffect(() => {
    const id = requestAnimationFrame(() => setPainted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <View style={StyleSheet.absoluteFill}>
      {!ready && <FeltFallback stops={stops} target={target} sx={rig.sx} sy={rig.sy} />}
      {painted && (
        <SkiaLoadFailed>
          <Suspense fallback={null}>
            <SkiaFelt lamp={rig.lamp} sx={rig.sx} sy={rig.sy} stops={stops} onReady={onReady} />
          </Suspense>
        </SkiaLoadFailed>
      )}
    </View>
  );
}
