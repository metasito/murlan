// The states an iOS capture has to cover, named once.
//
// Every loop this repo can run renders Chromium or renders nothing
// (`react-test-renderer` computes no layout and no paint). The owner tests on
// iOS through Expo Go, so a native-only rendering defect is invisible to the
// whole suite and the only instrument that reaches it is a person holding the
// device. That person needs to be asked for something specific, and to be able
// to reach it without playing to it — which is what this list and `app/capture.tsx`
// are for.
//
// The list is the contract between the two: `tests/e2e/lampSeats.spec.ts` walks
// it on web, `app/capture.tsx` walks it on the device, so a capture and a web
// run are of the same states rather than of two similar ones.
//
// Pure on purpose: the state a capture is of is a value, testable without a
// renderer, and `app/capture.tsx` is then a thin adapter over <GameTable> in
// the same way the three game screens are.
import {
  buildCombination,
  createDeck,
  type Card,
  type Combination,
  type GameState,
  type Player,
} from "./gameEngine.ts";

/** Bot names and seating as `app/lobby.tsx` fills empty seats. */
const BOTS = ["Luan", "Drita", "Besnik"] as const;
const VIEWER = "Ana";

/** The seat every capture is taken from. */
export const CAPTURE_VIEWER_SEAT = 0;

export interface CaptureState {
  /** Stable across renames — it is what `app/capture.tsx` takes as a route param. */
  id: string;
  /** What to look at, in one line. Read by a person, never by a player. */
  label: string;
  playerCount: 2 | 3 | 4;
  /** The seat on move. The lamp hangs over it and everything else keys off it. */
  turn: number;
  /**
   * Which side of the table that seat renders on, from the viewer's chair.
   * Stated rather than derived so the label cannot drift from the seating —
   * `tests/captureStates.test.ts` pins each against `seatDirection`.
   */
  side: "bottom" | "top" | "left" | "right";
  /** A combination already on the felt, so the pile draws under the lamp. */
  pile: boolean;
}

/**
 * Four lamp positions and one pile, which is the smallest set that has ever
 * caught anything. The turn is half of a state: the felt's pool, each seat's
 * ring, the other seats dimming and both action buttons all key off it, and
 * every capture taken before #205 was of the viewer's own turn — so the lamp
 * was only ever photographed at the bottom edge.
 */
export const CAPTURE_STATES: readonly CaptureState[] = [
  {
    id: "lamp-bottom",
    label: "Your turn — lamp at the bottom edge, over your own hand",
    playerCount: 4,
    turn: 0,
    side: "bottom",
    pile: false,
  },
  {
    id: "lamp-right",
    label: "Luan's turn — lamp at the right edge",
    playerCount: 4,
    turn: 1,
    side: "right",
    pile: false,
  },
  {
    id: "lamp-top",
    label: "Drita's turn — lamp at the top edge",
    playerCount: 4,
    turn: 2,
    side: "top",
    pile: false,
  },
  {
    id: "lamp-left",
    label: "Besnik's turn — lamp at the left edge",
    playerCount: 4,
    turn: 3,
    side: "left",
    pile: false,
  },
  {
    id: "pile-right",
    label: "Luan's turn with a combination on the felt — the pile under a lamp that is not yours",
    playerCount: 4,
    turn: 1,
    side: "right",
    pile: true,
  },
];

export function captureStateById(id: string | undefined): CaptureState | null {
  return CAPTURE_STATES.find((s) => s.id === id) ?? null;
}

/**
 * The whole deck, round-robin, from the engine's own unshuffled copy — so no
 * two seats share a card, every card appears exactly once, and the two seats
 * that hold one more than the others hold it here too.
 *
 * A full hand is the point. The side fans are deliberately wider than their
 * column, and it is that overflow a capture is being taken of; a short hand is
 * not the layout the table was solved for.
 */
function hands(deck: Card[], playerCount: number): Card[][] {
  return Array.from({ length: playerCount }, (_, seat) =>
    deck.filter((_c, i) => i % playerCount === seat)
  );
}

/**
 * Two cards of one rank lifted out of `deck`, as the combination they make.
 *
 * Taken before the deal, not out of a dealt hand. `createDeck` runs rank-major
 * within each suit and 13 does not divide by four, so a round-robin deal hands
 * each seat a different rank residue in every suit — no seat ends up holding a
 * pair at all, and lifting one out of a hand silently left the felt empty.
 */
function takePair(deck: Card[]): Combination | null {
  for (let i = 0; i < deck.length; i++) {
    const j = deck.findIndex((c, k) => k > i && c.rank === deck[i].rank);
    if (j < 0) continue;
    // High index first, so removing it does not shift the low one.
    const second = deck.splice(j, 1)[0];
    const first = deck.splice(i, 1)[0];
    return buildCombination([first, second]);
  }
  return null;
}

/**
 * The table as a capture wants it: mid-hand, nothing in flight, no deal
 * running, and the turn pinned where the state says.
 *
 * Pinned is the point. `app/game.tsx` runs the AI turn loop, so a seeded save
 * with the turn on a bot is a bot's turn for about a second — long enough to
 * navigate to and not to photograph. Nothing here advances the turn on its own.
 */
export function captureGameState(state: CaptureState): GameState {
  const deck = createDeck();
  // The pile's cards leave the deck before it is dealt, so the invariant that a
  // card appears exactly once holds across the hands and the felt together.
  const pile = state.pile ? takePair(deck) : null;
  const pileFrom = pile ? (state.turn + state.playerCount - 1) % state.playerCount : -1;
  const dealt = hands(deck, state.playerCount);

  const players: Player[] = Array.from({ length: state.playerCount }, (_, seat) => ({
    id: `capture_${seat}`,
    name: seat === CAPTURE_VIEWER_SEAT ? VIEWER : BOTS[seat - 1],
    hand: dealt[seat],
    type: seat === CAPTURE_VIEWER_SEAT ? "human" : "ai",
  }));

  return {
    players,
    currentTurnIndex: state.turn,
    lastPlayedCombination: pile,
    lastPlayedBy: pile ? pileFrom : -1,
    passCount: 0,
    gameMode: "free_for_all",
    roundWinner: null,
    gameOver: false,
    rankings: [],
    // Past the opening, so nothing waits on the 3 of spades and the table draws
    // as a hand in progress rather than a first move.
    firstPlayMade: true,
  };
}

/** The seat the lamp moves to when a capture asks for the swing. */
export function nextTurn(state: GameState): number {
  return (state.currentTurnIndex + 1) % state.players.length;
}
