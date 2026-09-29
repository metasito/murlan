import { FeltCanvas } from "./feltCanvas";
import { useFeltReady, type FeltProps } from "./feltReady";

export function Felt({ rig, stops }: FeltProps) {
  const [, onReady] = useFeltReady();
  return <FeltCanvas lamp={rig.lamp} sx={rig.sx} sy={rig.sy} stops={stops} onReady={onReady} />;
}
