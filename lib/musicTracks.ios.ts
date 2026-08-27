/**
 * ALAC-in-M4A tracks — iOS only. Why iOS needs its own container, and why
 * ALAC specifically: assets/music/README.md, "The iOS encode". Metro
 * resolves this file in place of musicTracks.ts on iOS, so the ~7.5 MB these
 * four files cost (README, "Cost") is paid once in the iOS bundle and never
 * reaches Android or web.
 */

/** See musicTracks.ts's CONTAINER for why this export exists. */
export const CONTAINER = "m4a" as const;

export const TRACKS = {
  menu: () => require("../assets/music/menu.m4a") as number,
  hand: () => require("../assets/music/hand.m4a") as number,
  cue: () => require("../assets/music/cue.m4a") as number,
  final: () => require("../assets/music/final.m4a") as number,
} as const;
