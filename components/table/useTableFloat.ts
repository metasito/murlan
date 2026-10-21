import { useCallback, useState } from "react";
import type { ViewedGameState } from "@/shared/protocol";
import type { ServerError } from "@/context/OnlineGameContext";
import { useTranslation } from "@/lib/i18n";
import { moveSince } from "@/lib/game/moves";
import { viewerOwnsSeat } from "@/components/seatLayout";
import { nextFloat, raised, type Float } from "./floatModel";

/** The float over the pile: what each new state, refusal and auto-pass raises, and a refusal raised by hand. */
export function useTableFloat(i: {
  gameState: ViewedGameState;
  error: ServerError | null;
  autoPassed: number;
  withdrawn: boolean;
  viewerSeat: number;
  spectating: boolean;
}): { float: Float | null; raise: (kind: "reject", text: string) => void } {
  const { gameState, error, autoPassed, withdrawn, viewerSeat, spectating } = i;
  const { t } = useTranslation();
  const inputs = { gameState, error, autoPassed, withdrawn };
  const [seen, setSeen] = useState<typeof inputs>({ ...inputs, error: null });
  const [float, setFloat] = useState<Float | null>(null);
  const moved = seen.gameState !== gameState;
  const move = moved ? moveSince(seen.gameState.lastMove, gameState.lastMove) : null;
  const erred = seen.error?.seq !== error?.seq;
  if (moved || erred || seen.autoPassed !== autoPassed || seen.withdrawn !== withdrawn) {
    setSeen(inputs);
    const shown = nextFloat(
      float,
      {
        viewerPassed: moved
          ? move?.kind === "pass" && viewerOwnsSeat(move.seat, viewerSeat, spectating)
          : undefined,
        error: erred ? error : undefined,
        autoPassed: seen.autoPassed !== autoPassed,
        withdrawn,
        withdrew: withdrawn && !seen.withdrawn,
      },
      { passed: t("gameShared.passedLabel"), autoPass: t("game.autoPassTitle") }
    );
    if (shown !== float) setFloat(shown);
  }
  const raise = useCallback((kind: "reject", text: string) => setFloat((standing) => raised(standing, kind, text)), []);
  return { float, raise };
}
