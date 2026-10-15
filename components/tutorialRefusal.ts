// The tutorial's own sentence for a refusal GIOCA's staged play reports. A
// refusal with none here gets the game's (`playRefusalLabel`).

import type { TranslationKey } from "@/lib/i18n";
import type { PlayButtonLabel } from "./turnTimerUi.ts";

export const TUTORIAL_REFUSAL_KEYS: Partial<Record<PlayButtonLabel, TranslationKey>> = {
  notACombination: "tutorial.errNotAValidCombo",
  royalUnbeatable: "tutorial.errRoyalBeatsAll",
  bombOnly: "tutorial.errOnlyHigherBomb",
  wrongType: "tutorial.errSameType",
  wrongLength: "tutorial.errSameLength",
  tooLow: "tutorial.errTooWeak",
};
