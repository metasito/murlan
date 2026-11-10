// The fan's gloss stays out of the web first load (docs/BUNDLE.md): it is its own chunk, asked for when the
// table mounts. Until it has drawn, and for good where it fails to load, the backs draw their own (`CardFan`).
import { lazy, Suspense, type ComponentProps } from "react";
import type { FanGloss } from "./FanGloss";
import { SkiaLoadFailed } from "./feltSkia.web";

const load = () => import("./FanGloss");
const Gloss = lazy(async () => ({ default: (await load()).FanGloss }));

export function preloadFanGloss(): void {
  void load().catch(() => {});
}

export function FanGlossSlot(props: ComponentProps<typeof FanGloss>) {
  return (
    <SkiaLoadFailed>
      <Suspense fallback={null}>
        <Gloss {...props} />
      </Suspense>
    </SkiaLoadFailed>
  );
}
