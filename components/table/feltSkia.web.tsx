// CanvasKit stays out of the web first load (docs/BUNDLE.md): the boundary that loads it is its
// own chunk, mounted a frame after the table has painted, and the fallback holds the felt until
// Skia has drawn.
import { lazy, Suspense, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { FeltFallback } from "./feltFallback";
import { useFeltReady, type FeltProps } from "./feltReady";

const SkiaFelt = lazy(() => import("./feltSkiaBoundary"));

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
        <Suspense fallback={null}>
          <SkiaFelt lamp={rig.lamp} sx={rig.sx} sy={rig.sy} stops={stops} onReady={onReady} />
        </Suspense>
      )}
    </View>
  );
}
