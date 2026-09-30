import { dealCards, findStartingPlayer, type Card, type Player } from "./game/gameEngine.ts";

/** The launch argument ios.yml's flows pass so that the viewer's seat opens, and their tap on a card always runs. */
export const E2E_OPENER_KEY = "MurlanE2EOpener";

/** A fresh deal in which `seat` opens. Dealt again rather than traded: two equal lowest cards open from the lower seat. */
export function dealOpeningTo(playerCount: number, firstSeat: number, seat: number): Card[][] {
  for (;;) {
    const { hands } = dealCards(playerCount, firstSeat);
    if (findStartingPlayer(hands.map((hand) => ({ hand }) as Player)).playerIdx === seat) return hands;
  }
}
