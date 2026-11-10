import type { ReactNode, RefObject } from "react";
import { useSharedValue, type SharedValue } from "react-native-reanimated";
import type { Lamp } from "./lampRig";

export interface FeltEndsArgs {
  lamp: SharedValue<Lamp>;
  /** 1 while the canvas still crosses its two ends itself, 0 once it has. */
  settle: SharedValue<number>;
  /** Moves when anything an end draws changes besides the sway. */
  content: SharedValue<number>;
  host: RefObject<unknown>;
}

export interface FeltEnds {
  /** -1 draws end A of a rested lamp and 1 end B; 0 the lamp as it is. */
  side: SharedValue<number>;
  layer: ReactNode;
}

/** Native keeps the settled felt's own crossing of its two ends. */
export function useFeltEnds(_args: FeltEndsArgs): FeltEnds {
  return { side: useSharedValue(0), layer: null };
}
