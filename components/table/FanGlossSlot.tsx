import type { ComponentProps, ReactElement } from "react";
import type { FanGloss } from "./FanGloss";

/** Native draws every back's gloss itself (ADR-0020, decision 4): there is no fan gloss to slot in. */
export function FanGlossSlot(_props: ComponentProps<typeof FanGloss>): ReactElement | null {
  return null;
}
