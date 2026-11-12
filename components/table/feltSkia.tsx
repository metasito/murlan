import { Platform } from "react-native";
import { FeltCanvas } from "./feltCanvas";
import { EndBNative } from "./feltEndBNative";
import type { FeltProps } from "./feltReady";

/** Whether the settled felt crosses its two ends with an animation on this platform, or draws the sway live: docs/adr/0020-the-table-at-rest-plays-precomputed-tracks.md. */
const SWAY_ENDS: Record<"ios" | "android", boolean> = { ios: true, android: true };

const ends = Platform.OS === "ios" || Platform.OS === "android" ? SWAY_ENDS[Platform.OS] : false;

export function Felt({ rig, stops, onReady, cards, grey }: FeltProps) {
  return <FeltCanvas lamp={rig.lamp} now={rig.now} sx={rig.sx} sy={rig.sy} stops={stops} onReady={onReady} cards={cards} grey={grey} Ends={ends ? EndBNative : undefined} />;
}
