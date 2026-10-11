// Loaded beside the Skia felt, so it is drawing when the felt is; until then the fallback's per-card
// shadows fall on the neighbouring cards, and this draws nothing.
import { lazy, Suspense, useEffect, useState } from "react";
import type { HandShadeProps } from "./feltReady";
import { drawsOnGpu, SkiaLoadFailed } from "./feltSkia.web";

const SkiaHandShade = lazy(() => import("./feltSkiaBoundary").then((m) => ({ default: m.HandShadeBoundary })));

export function HandShade(props: HandShadeProps) {
  const [skia, setSkia] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setSkia(drawsOnGpu()));
    return () => cancelAnimationFrame(id);
  }, []);
  if (!skia) return null;
  return (
    <SkiaLoadFailed>
      <Suspense fallback={null}>
        <SkiaHandShade {...props} />
      </Suspense>
    </SkiaLoadFailed>
  );
}
