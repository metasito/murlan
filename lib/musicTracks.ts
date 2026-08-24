/**
 * WebM Opus tracks — web and Android. iOS resolves musicTracks.ios.ts instead,
 * so this file's requires are never in its module graph; see lib/music.ts's
 * docblock for why iOS needs its own container.
 *
 * Requires are behind functions so Metro can see them statically while the
 * bytes stay out of the initial payload — the web bundle's ceiling is ~1 MB
 * gzip and these are 1.5 MB on their own.
 */
export const CONTAINER = "webm" as const;

export const TRACKS = {
  menu: () => require("../assets/music/menu.webm") as number,
  hand: () => require("../assets/music/hand.webm") as number,
  cue: () => require("../assets/music/cue.webm") as number,
  final: () => require("../assets/music/final.webm") as number,
} as const;
