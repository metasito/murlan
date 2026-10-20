// Metro resolves a `.web.tsx` twin on web, but tsc only ever sees the native file: each twin must
// satisfy its native module's type, or a caller compiles against an export web does not have.
import type * as FoilMask from "./FoilMask";
import * as FoilMaskWeb from "./FoilMask.web";
import type * as feltSkia from "./feltSkia";
import * as feltSkiaWeb from "./feltSkia.web";
import type * as handShade from "./handShade";
import * as handShadeWeb from "./handShade.web";
import type * as particleLayer from "./particleLayer";
import * as particleLayerWeb from "./particleLayer.web";

export const twins: [typeof FoilMask, typeof feltSkia, typeof handShade, typeof particleLayer] = [
  FoilMaskWeb,
  feltSkiaWeb,
  handShadeWeb,
  particleLayerWeb,
];
