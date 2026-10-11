import { HandShadeCanvas } from "./handShadeCanvas";
import type { HandShadeProps } from "./feltReady";

export function HandShade({ lamp, cards }: HandShadeProps) {
  return <HandShadeCanvas lamp={lamp} cards={cards} />;
}
