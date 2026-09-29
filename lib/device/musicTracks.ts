/** FLAC, decoded natively by react-native-audio-api on iOS and Android (assets/music/README.md). Web resolves musicTracks.web.ts. */

/**
 * Not read by the app at all — this and the matching export in
 * musicTracks.web.ts are what tests/native/musicPlatform.test.tsx asserts
 * against `Platform.OS`, the only thing in the suite that pins Metro
 * resolving the right container per platform (#178). A dead-code sweep that
 * doesn't check the test first will delete the one assertion covering it.
 */
export const CONTAINER = "flac" as const;

export const TRACKS = {
  menu: () => require("../../assets/music/native/menu.flac") as number,
  hand: () => require("../../assets/music/native/hand.flac") as number,
  cue: () => require("../../assets/music/native/cue.flac") as number,
} as const;

export type TrackId = keyof typeof TRACKS;
