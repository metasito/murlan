// Where a seat finished, as the app draws it.
//
// Both halves were declared four times over — the badge text on the results
// board, the profile, the history row and the hand breakdown, and the podium
// colours in three of those.
import { Colors } from "./theme";
import type { TranslationKey } from "./i18n";

const PLACEMENT_COLORS = [
  Colors.podiumGold,
  Colors.podiumSilver,
  Colors.podiumBronze,
  Colors.textMuted,
];

/** 1-based, as `match_history.placement` and the engine's rankings state it. */
export function placementColor(placement: number): string {
  return PLACEMENT_COLORS[placement - 1] ?? Colors.textMuted;
}

const POSITION_LABEL_KEYS: TranslationKey[] = [
  "result.position1",
  "result.position2",
  "result.position3",
  "result.position4",
];

/** The badge's own words, or null past the four the copy names. */
export function positionLabelKey(placement: number): TranslationKey | null {
  return POSITION_LABEL_KEYS[placement - 1] ?? null;
}
