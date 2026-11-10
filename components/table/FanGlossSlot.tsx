import type { ComponentProps } from "react";
import { FanGloss } from "./FanGloss";

export function FanGlossSlot(props: ComponentProps<typeof FanGloss>) {
  return <FanGloss {...props} />;
}
