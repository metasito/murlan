import { HandShadeCanvas } from "./handShadeCanvas";
import type { HandShadeProps } from "./feltReady";

export function HandShade(props: HandShadeProps) {
  return <HandShadeCanvas {...props} />;
}
