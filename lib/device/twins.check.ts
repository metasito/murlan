// Metro resolves a `.web.ts` twin on web, but tsc only ever sees the native file: each twin must
// satisfy its native module's type, or a caller compiles against an export web does not have.
import type * as audioEngine from "./audioEngine";
import * as audioEngineWeb from "./audioEngine.web";
import type * as fonts from "./fonts";
import * as fontsWeb from "./fonts.web";
import type * as hapticsEngine from "./hapticsEngine";
import * as hapticsEngineWeb from "./hapticsEngine.web";
import type * as inviteTaps from "./inviteTaps";
import * as inviteTapsWeb from "./inviteTaps.web";
import type * as musicTracks from "./musicTracks";
import * as musicTracksWeb from "./musicTracks.web";
import type * as flushSync from "../flushSync";
import * as flushSyncWeb from "../flushSync.web";

export const twins: [
  typeof audioEngine,
  typeof fonts,
  typeof hapticsEngine,
  typeof inviteTaps,
  typeof musicTracks,
  typeof flushSync,
] = [audioEngineWeb, fontsWeb, hapticsEngineWeb, inviteTapsWeb, musicTracksWeb, flushSyncWeb];
