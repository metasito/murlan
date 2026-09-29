/** Behind functions so Metro sees the requires while the bytes stay out of the web bundle's initial payload. */
export const CONTAINER = "webm" as const;

export const TRACKS = {
  menu: () => require("../../assets/music/menu.webm") as number,
  hand: () => require("../../assets/music/hand.webm") as number,
  cue: () => require("../../assets/music/cue.webm") as number,
} as const;

export type TrackId = keyof typeof TRACKS;
