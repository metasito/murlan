// tests/soak/invariants.ts — what the soak believes, stated so it can be tested.
//
// A soak is only worth its runtime if its oracle can fail. These are pure
// functions over the views the clients hold, so `tests/soakInvariants.test.ts`
// can hand them a table that is wrong on purpose and watch each one fire.
//
// The oracle is *agreement*, not a fixture: no expected value is written down
// anywhere, so the soak can catch a defect nobody thought to look for.

/** One seat's view of the table, as that client last received it. */
export interface SeatView {
  /** Which seat this client occupies. */
  seat: number;
  currentTurnIndex: number;
  gameOver: boolean;
  /** Cards in each seat's hand, indexed by seat, as this client sees it. */
  handCounts: number[];
  /** This client's own cards. Only the viewer's hand is ever sent in full. */
  ownHand: string[];
}

export interface Violation {
  kind: string;
  detail: string;
}

const NO_VIOLATIONS: Violation[] = [];

/**
 * Every client is looking at the same table.
 *
 * Compare only *settled* views — the server broadcasts to each recipient
 * separately, so two views captured mid-flight disagree for a reason that is
 * not a defect. `soak.ts` waits for quiescence before calling this.
 */
export function checkAgreement(views: SeatView[]): Violation[] {
  if (views.length < 2) return NO_VIOLATIONS;
  const found: Violation[] = [];
  const [first, ...rest] = views;

  for (const view of rest) {
    if (view.currentTurnIndex !== first.currentTurnIndex) {
      found.push({
        kind: "turn-disagreement",
        detail:
          `seat ${first.seat} thinks it is seat ${first.currentTurnIndex}'s turn, ` +
          `seat ${view.seat} thinks it is seat ${view.currentTurnIndex}'s`,
      });
    }
    if (view.gameOver !== first.gameOver) {
      found.push({
        kind: "over-disagreement",
        detail:
          `seat ${first.seat} has gameOver=${first.gameOver}, ` +
          `seat ${view.seat} has ${view.gameOver}`,
      });
    }
    if (view.handCounts.join(",") !== first.handCounts.join(",")) {
      found.push({
        kind: "hand-count-disagreement",
        detail:
          `seat ${first.seat} sees [${first.handCounts}], ` +
          `seat ${view.seat} sees [${view.handCounts}]`,
      });
    }
  }
  return found;
}

/**
 * A card is in exactly one place.
 *
 * `CLAUDE.md` makes this the standing invariant of the table, and the two ways
 * to break it are opposite: the same card dealt to two players, or a client's
 * own hand disagreeing with the count everyone else was told it holds.
 */
export function checkCards(views: SeatView[], deckSize: number): Violation[] {
  const found: Violation[] = [];
  const owner = new Map<string, number>();

  for (const view of views) {
    for (const id of view.ownHand) {
      const held = owner.get(id);
      if (held !== undefined && held !== view.seat) {
        found.push({
          kind: "card-in-two-hands",
          detail: `card ${id} is held by seat ${held} and seat ${view.seat}`,
        });
      }
      owner.set(id, view.seat);
    }
    // What this client holds, against what the table was told it holds.
    const advertised = view.handCounts[view.seat];
    if (advertised !== undefined && advertised !== view.ownHand.length) {
      found.push({
        kind: "own-hand-mismatch",
        detail:
          `seat ${view.seat} holds ${view.ownHand.length} cards but the table ` +
          `was told it holds ${advertised}`,
      });
    }
  }

  const total = views[0]?.handCounts.reduce((sum, n) => sum + n, 0) ?? 0;
  if (total > deckSize) {
    found.push({
      kind: "more-cards-than-deck",
      detail: `${total} cards are in hands, and the deck holds ${deckSize}`,
    });
  }
  return found;
}

/**
 * Nobody is waiting on a seat that is not there. `-1` is the server's own
 * "nobody", and is not a violation — a finished hand has no player to act.
 */
export function checkTurnIsSeated(views: SeatView[]): Violation[] {
  const found: Violation[] = [];
  for (const view of views) {
    const seats = view.handCounts.length;
    if (view.gameOver) continue;
    if (view.currentTurnIndex < 0 || view.currentTurnIndex >= seats) {
      found.push({
        kind: "turn-off-the-table",
        detail: `seat ${view.seat} was told it is seat ${view.currentTurnIndex}'s turn, of ${seats} seats`,
      });
    }
  }
  return found;
}

/**
 * The cards in play never grow. A manche only ever moves cards out of hands —
 * the one exception, the exchange, moves one card between two of them and so
 * leaves the total alone.
 */
export function checkTotalNeverGrows(
  views: SeatView[],
  highWaterMark: number
): Violation[] {
  const total = views[0]?.handCounts.reduce((sum, n) => sum + n, 0) ?? 0;
  if (total > highWaterMark) {
    return [
      {
        kind: "cards-appeared",
        detail: `${total} cards are in hands now, and there were ${highWaterMark} before`,
      },
    ];
  }
  return NO_VIOLATIONS;
}

export function checkAll(
  views: SeatView[],
  deckSize: number,
  highWaterMark: number
): Violation[] {
  return [
    ...checkAgreement(views),
    ...checkCards(views, deckSize),
    ...checkTurnIsSeated(views),
    ...checkTotalNeverGrows(views, highWaterMark),
  ];
}
