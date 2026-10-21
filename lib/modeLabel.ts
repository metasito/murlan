import type { GameMode } from "./game/gameEngine.ts";
import type { TFn } from "./i18n.ts";

/** A mode's name in the player's language; the short form is for a row with little room. */
export function modeLabel(mode: GameMode, t: TFn, form: "full" | "short" = "full"): string {
  if (mode === "teams") return t(form === "short" ? "term.mode.teamsShort" : "term.mode.teams");
  return t(form === "short" ? "term.mode.freeForAllShort" : "term.mode.freeForAll");
}
