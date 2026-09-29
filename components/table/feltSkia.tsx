import { FeltCanvas } from "./feltCanvas";
import { useFeltReady, type FeltProps } from "./feltReady";

export function Felt({ rig, stops, light }: FeltProps) {
  const [, onReady] = useFeltReady();
  return <FeltCanvas lamp={rig.lamp} sx={rig.sx} sy={rig.sy} stops={stops} light={light} onReady={onReady} />;
}
