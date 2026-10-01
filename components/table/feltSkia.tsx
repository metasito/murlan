import { FeltCanvas } from "./feltCanvas";
import type { FeltProps } from "./feltReady";

export function Felt({ rig, stops, onReady, cards, names }: FeltProps) {
  return <FeltCanvas lamp={rig.lamp} sx={rig.sx} sy={rig.sy} stops={stops} onReady={onReady} cards={cards} names={names} />;
}
