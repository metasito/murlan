import type { CombinationType } from "./game/gameEngine.ts";
import type { TFn, TranslationKey } from "./i18n.ts";

const KEYS: Record<CombinationType, TranslationKey> = {
  single: "term.combo.single",
  pair: "term.combo.pair",
  triple: "term.combo.triple",
  straight: "term.combo.straight",
  bomb: "term.combo.bomb",
  royal_straight: "term.combo.royalStraight",
};

/** A combination's name in the player's language, glyph included. */
export function comboName(type: CombinationType, t: TFn): string {
  return t(KEYS[type]);
}

/** The name as a screen reader should hear it: without the glyph the chip draws. */
export function spokenComboName(type: CombinationType, t: TFn): string {
  return comboName(type, t).replace(/^[^\p{L}\p{N}]+/u, "");
}
