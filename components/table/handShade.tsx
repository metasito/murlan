import type { ReactElement } from "react";
import { HandShadeCanvas } from "./handShadeCanvas";
import type { HandShadeProps } from "./feltReady";

export function HandShade(props: HandShadeProps): ReactElement | null {
  return <HandShadeCanvas {...props} />;
}
