/**
 * ALAC-in-M4A tracks — iOS only, losslessly re-encoded from musicTracks.ts's
 * WebM set because AVFoundation cannot demux WebM at all (#178,
 * assets/music/README.md). Metro resolves this file in place of
 * musicTracks.ts on iOS, so the ~7.5 MB these four files cost
 * (assets/music/README.md, "Cost") is paid once in the iOS bundle and never
 * reaches Android or web.
 */
export const CONTAINER = "m4a" as const;

export const TRACKS = {
  menu: () => require("../assets/music/menu.m4a") as number,
  hand: () => require("../assets/music/hand.m4a") as number,
  cue: () => require("../assets/music/cue.m4a") as number,
  final: () => require("../assets/music/final.m4a") as number,
} as const;
