// What a throw decides, from the state it was thrown out of.
//
// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".

import type { Card, Combination } from "@/lib/game/gameEngine";
import { handCountOf } from "../../shared/protocol.ts";
import { fanPoint } from "../fanGeometry.ts";
import type { CardFrom } from "../flightPose.ts";
import { FAN_CARD_SCALE } from "../impact.ts";
import { seatDirection, type FlyDirection } from "../seatLayout.ts";
import { ownSlotFrom, type Point, type Seating, type TableLayout } from "../tableLayout.ts";

interface ThrownPlay {
  dir: FlyDirection;
  cards: Card[];
  /** Where each card starts, from the pile's centre: its own hand slot, or its seat's fan. */
  from: CardFrom[];
  /** Where it lands: the pile's centre, in window points. */
  pile: Point;
  /** Impact reads heavier for these. */
  heavy: boolean;
  /** The throw emptied the hand it came from, so the going-out catch is owed. */
  emptiedHand: boolean;
}

export function readThrownPlay(
  play: { combo: Combination; playedBy: number },
  layout: TableLayout,
  seating: Seating,
  handOrigins?: ReadonlyMap<string, CardFrom>
): ThrownPlay {
  const { combo, playedBy } = play;
  const { players } = seating;
  const dir = seatDirection(playedBy, seating.viewerSeat, players.length);
  const origin = layout.seatPoint(dir);
  const thrower = players[playedBy];
  let from: CardFrom[];
  if (dir === "bottom") {
    from = combo.cards.map((card) => ownSlotFrom(origin, handOrigins?.get(card.id)));
  } else {
    const fan = fanPoint(origin, dir, layout.scale, thrower ? handCountOf(thrower) : 0);
    from = combo.cards.map(() => ({ ...fan, scale: FAN_CARD_SCALE }));
  }
  return {
    dir,
    cards: combo.cards,
    heavy: combo.type === "bomb" || combo.type === "royal_straight",
    emptiedHand: !!thrower && handCountOf(thrower) === 0,
    from,
    pile: layout.anchors.pile,
  };
}
