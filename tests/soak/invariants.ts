// tests/soak/invariants.ts — what the soak believes, stated so it can be tested.
//
// A soak is only worth its runtime if its oracle can fail. These are pure
// functions over the views the clients hold, so `tests/tooling/soakInvariants.test.ts`
// can hand them a table that is wrong on purpose and watch each one fire.
//
// The oracle is *agreement*, not a fixture: no expected value is written down
// anywhere, so the soak can catch a defect nobody thought to look for.
import type { SeatAction } from "./soak.ts";

/** One seat's view of the table, as that client last received it. */
export interface SeatView {
  /** Which seat this client occupies. */
  seat: number;
  currentTurnIndex: number;
  roundOver: boolean;
  /** Cards in each seat's hand, indexed by seat, as this client sees it. */
  handCounts: number[];
  /** This client's own cards. Only the viewer's hand is ever sent in full. */
  ownHand: string[];
  /** `lastMove.seq`: the round's moves counted from the deal's 0. */
  seq: number;
}

export interface Violation {
  kind: string;
  detail: string;
}

const NO_VIOLATIONS: Violation[] = [];

/** A run that never finished a round compared nothing at the moments that matter most. */
export function progressViolations({ moves, rounds }: { moves: number; rounds: number }): Violation[] {
  if (moves > 0 && rounds > 0) return NO_VIOLATIONS;
  return [{ kind: "no-progress", detail: `${moves} rounds of moves and ${rounds} rounds: the soak agreed about nothing` }];
}

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
    if (view.roundOver !== first.roundOver) {
      found.push({
        kind: "over-disagreement",
        detail:
          `seat ${first.seat} has roundOver=${first.roundOver}, ` +
          `seat ${view.seat} has ${view.roundOver}`,
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
    if (view.roundOver) continue;
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
 * The cards in play never grow. A round only ever moves cards out of hands —
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

/** A run with chaos on that injected nothing tested none of the faults it reports agreement over. */
export function injectionViolations({ chaos, injected }: { chaos: number; injected: number }): Violation[] {
  if (chaos <= 0 || injected > 0) return NO_VIOLATIONS;
  return [{ kind: "no-faults-injected", detail: `chaos was ${chaos} and no fault was injected: nothing adversarial was tested` }];
}

/**
 * One arming can lose to the round ending before its seat is on move again, so a single
 * unreached stale fault is the round's doing; two in a run is the fault not being reached.
 */
const STALE_UNREACHED_FLOOR = 2;

/** A stale play is injected only on its seat's own turn; a run that never got there tested no stale cards. */
export function staleReachViolations({ armed, injected }: { armed: number; injected: number }): Violation[] {
  if (injected > 0 || armed < STALE_UNREACHED_FLOOR) return NO_VIOLATIONS;
  return [{ kind: "stale-never-reached", detail: `a stale play was armed ${armed} times and its seat was never on move again` }];
}

/** How the server answered one intent; `null` is no answer at all. */
export interface IntentAck {
  ok: boolean;
  code?: string;
}

const sorted = (ids: string[]) => [...ids].sort().join(",");

function sameView(a: SeatView, b: SeatView): boolean {
  return (
    a.currentTurnIndex === b.currentTurnIndex &&
    a.roundOver === b.roundOver &&
    a.seq === b.seq &&
    a.handCounts.join(",") === b.handCounts.join(",") &&
    sorted(a.ownHand) === sorted(b.ownHand)
  );
}

const describeView = (v: SeatView) =>
  `turn ${v.currentTurnIndex}, seq ${v.seq}, over ${v.roundOver}, counts [${v.handCounts}], hand [${v.ownHand.join(" ")}]`;

/** Every seat that had a view still has it, field for field. */
export function checkUnchanged(fault: string, before: SeatView[], after: SeatView[]): Violation[] {
  const now = new Map(after.map((v) => [v.seat, v]));
  return before.flatMap((was) => {
    const is = now.get(was.seat);
    if (is && sameView(was, is)) return [];
    return [{
      kind: "fault-changed-view",
      detail: `after ${fault}, seat ${was.seat} went from ${describeView(was)} to ${is ? describeView(is) : "no view"}`,
    }];
  });
}

/** A fault the table must turn down: answered, refused (with `code`, when given), and nothing moved. */
export function checkRefused(
  fault: string,
  ack: IntentAck | null,
  before: SeatView[],
  after: SeatView[],
  code?: string
): Violation[] {
  const found: Violation[] = [];
  if (!ack) found.push({ kind: "fault-unanswered", detail: `${fault} was never answered` });
  else if (ack.ok) found.push({ kind: "fault-accepted", detail: `${fault} was accepted` });
  else if (code !== undefined && ack.code !== code) {
    found.push({ kind: "fault-wrong-refusal", detail: `${fault} was refused with ${ack.code}, not ${code}` });
  }
  return [...found, ...checkUnchanged(fault, before, after)];
}

/**
 * `move` landed exactly once: every view after is its view before with that one
 * move applied — the counter up by one, the mover's cards gone, and, for a
 * giveback, the one card arriving in exactly one other hand.
 */
export function checkLandedOnce(
  fault: string,
  before: SeatView[],
  after: SeatView[],
  move: SeatAction
): Violation[] {
  const moved = move.kind === "play" ? move.cardIds : move.kind === "exchange" ? [move.cardId] : [];
  const now = new Map(after.map((v) => [v.seat, v]));
  const found: Violation[] = [];
  for (const was of before) {
    const is = now.get(was.seat);
    if (!is) {
      found.push({ kind: "move-not-landed-once", detail: `after ${fault}, seat ${was.seat} has no view` });
      continue;
    }
    if (is.seq !== was.seq + 1) {
      found.push({
        kind: "move-not-landed-once",
        detail: `after ${fault}, seat ${was.seat} saw the move counter go ${was.seq} -> ${is.seq}, not up by one`,
      });
      continue;
    }
    const delta = is.handCounts.map((n, i) => n - (was.handCounts[i] ?? 0));
    const rose = delta.flatMap((d, i) => (i !== move.seat && d > 0 ? [i] : []));
    const receiver = move.kind === "exchange" && rose.length === 1 ? rose[0] : -1;
    const expected = delta.map((_, i) => (i === move.seat ? -moved.length : i === receiver ? 1 : 0));
    const countsRight = delta.join(",") === expected.join(",") && (move.kind !== "exchange" || receiver >= 0);
    const expectedHand =
      was.seat === move.seat
        ? was.ownHand.filter((id) => !moved.includes(id))
        : was.seat === receiver
          ? [...was.ownHand, ...moved]
          : was.ownHand;
    if (!countsRight || sorted(is.ownHand) !== sorted(expectedHand)) {
      found.push({
        kind: "move-landed-wrong",
        detail:
          `after ${fault}, ${move.kind} by seat ${move.seat} [${moved.join(" ")}] took seat ${was.seat} ` +
          `from ${describeView(was)} to ${describeView(is)}`,
      });
    }
  }
  return found;
}

/** An intent sent again later, inside the server's memory of it: answered as it was, and nothing moves. */
export function checkRepeatAnswered(
  fault: string,
  original: IntentAck | null,
  again: IntentAck | null,
  before: SeatView[],
  after: SeatView[]
): Violation[] {
  const found: Violation[] = [];
  if (!again) found.push({ kind: "fault-unanswered", detail: `${fault} was never answered` });
  else if (!original || original.ok !== again.ok || original.code !== again.code) {
    found.push({ kind: "duplicate-ack-differs", detail: `${fault} was answered ${JSON.stringify(again)}, the original ${JSON.stringify(original)}` });
  }
  return [...found, ...checkUnchanged(fault, before, after)];
}

/** The same intent sent twice at once: one answer for both, and one move on the table. */
export function checkDuplicate(
  first: IntentAck | null,
  second: IntentAck | null,
  before: SeatView[],
  after: SeatView[],
  move: SeatAction
): Violation[] {
  const fault = `a duplicated ${move.kind} by seat ${move.seat}`;
  const found: Violation[] = [];
  if (!first || !second) {
    found.push({ kind: "fault-unanswered", detail: `${fault}: an answer never came (${JSON.stringify([first, second])})` });
  } else if (first.ok !== second.ok || first.code !== second.code) {
    found.push({ kind: "duplicate-ack-differs", detail: `${fault} was answered ${JSON.stringify(first)}, then ${JSON.stringify(second)}` });
  }
  const landed = first?.ok ? checkLandedOnce(fault, before, after, move) : checkUnchanged(fault, before, after);
  return [...found, ...landed];
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

/** A module map the server should have emptied once every seat has left. */
export function checkTeardown(maps: Record<string, { size: number }>): Violation[] {
  return Object.entries(maps)
    .filter(([, map]) => map.size > 0)
    .map(([name, map]) => ({
      kind: "teardown-leak",
      detail: `${name} still holds ${map.size} entries after teardown`,
    }));
}
