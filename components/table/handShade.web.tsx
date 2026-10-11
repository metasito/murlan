// Mounted only once the Skia felt has drawn: CanvasKit is loaded by then, and where it never is the
// fallback's per-card shadows already fall on the neighbouring cards.
import { lazy, Suspense } from "react";
import type { HandShadeProps } from "./feltReady";
import { SkiaLoadFailed } from "./feltSkia.web";

const SkiaHandShade = lazy(() => import("./handShadeBoundary"));

export function HandShade({ lamp, cards, ready }: HandShadeProps) {
  if (!ready) return null;
  return (
    <SkiaLoadFailed>
      <Suspense fallback={null}>
        <SkiaHandShade lamp={lamp} cards={cards} />
      </Suspense>
    </SkiaLoadFailed>
  );
}
