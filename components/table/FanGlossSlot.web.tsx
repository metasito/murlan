// The fan's gloss stays out of the web first load (docs/BUNDLE.md): it is its own chunk, and the fans draw
// without it until it has loaded.
import { lazy, Suspense, type ComponentProps } from "react";
import type { FanGloss } from "./FanGloss";

const Gloss = lazy(async () => ({ default: (await import("./FanGloss")).FanGloss }));

export function FanGlossSlot(props: ComponentProps<typeof FanGloss>) {
  return (
    <Suspense fallback={null}>
      <Gloss {...props} />
    </Suspense>
  );
}
