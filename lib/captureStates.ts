// The states an iOS capture has to cover, named once.
//
// Every loop this repo can run renders Chromium or renders nothing
// (`react-test-renderer` computes no layout and no paint). The owner tests on
// iOS on a build of the app, so a native-only rendering defect is invisible to the
// whole suite and the only instrument that reaches it is a person holding the
// device. That person needs to be asked for something specific, and to be able
// to reach it without playing to it — which is what this list and `app/capture.tsx`
// are for.
//
// The lists are the contract between the two: `tests/e2e/lampSeats.spec.ts` and `seatsDoNotMove.spec.ts`
// walk them on web, `app/capture.tsx` on the device, so a capture and a web
// run are of the same states rather than of two similar ones.
//
// Pure on purpose: the state a capture is of is a value, testable without a
// renderer, and `app/capture.tsx` is then a thin adapter over <GameTable> in
// the same way the three game screens are.
import type { GameState } from "./game/gameEngine.ts";
import { BOT_PERSONALITIES, botSeatNames } from "./game/botPersonalities.ts";
import type { OwnLink } from "./ownLink.ts";
import { reach, type Situation, type Step } from "./situation.ts";

/** The bots `app/lobby.tsx` fills the seats past the viewer's with, named as it names them. */
const lobbyBots = (playerCount: number): string[] =>
  botSeatNames(Array.from({ length: playerCount - 1 }, (_, i) => BOT_PERSONALITIES[i % BOT_PERSONALITIES.length].id));
const [RIGHT, TOP, LEFT] = lobbyBots(4);
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
   * `tests/tooling/captureStates.test.ts` pins each against `seatDirection`.
   */
  side: "bottom" | "top" | "left" | "right";
  /** A combination already on the felt, so the pile draws under the lamp; `"bomb"` lands four of a kind. */
  pile: boolean | "bomb";
  /** What each opponent holds; "out" has finished the round. Absent, each holds what its situation left it. */
  counts?: Readonly<Record<"right" | "top" | "left", number | "out">>;
  /** The viewer's own connection, as the online table reads it. Absent, it is up. */
  link?: OwnLink;
  /** The deal and the moves that reach this state, played through the engine. */
  situation: Situation;
}

const play = (seat: number, cards: string): Step => ({ seat, play: cards });
const pass = (...seats: number[]): Step[] => seats.map((seat) => ({ seat, pass: true }));
const giveback = (seat: number, card: string): Step => ({ seat, giveback: card });

/**
 * Every capture opens on an exchange: it leaves no 3♠ for the table to wait on, so once a play has
 * landed the round reads as one in progress.
 */
const exchange = (winnerSeat: number, loserSeat: number) => ({ kind: "exchange", winnerSeat, loserSeat }) as const;

/** One round whose tricks are won by the viewer, then the left, top and right seats in turn. */
const LAMP_TRICKS: readonly (readonly Step[])[] = [
  [giveback(2, "4_clubs"), play(1, "5_hearts"), play(0, "6_hearts"), ...pass(3, 2, 1)],
  [play(0, "7_hearts"), play(3, "8_hearts"), ...pass(2, 1, 0)],
  [play(3, "9_hearts"), play(2, "10_hearts"), ...pass(1, 0, 3)],
  [play(2, "J_hearts"), play(1, "Q_hearts"), ...pass(0, 3, 2)],
];

const lampRound = (name: string, tricks: number): Situation => ({
  name,
  seats: 4,
  mode: "free_for_all",
  opening: exchange(2, 1),
  holding: {
    0: "6_hearts 7_hearts joker_bw",
    1: "joker_colored 5_hearts Q_hearts",
    2: "4_clubs 10_hearts J_hearts",
    3: "8_hearts 9_hearts",
  },
  moves: LAMP_TRICKS.slice(0, tricks).flat(),
});

/** The seats after `seat` in turn order, which runs down the seat numbers. */
const after = (seat: number, seats: number, count: number): number[] =>
  Array.from({ length: count }, (_, k) => (seat - 1 - k + 2 * seats) % seats);

/**
 * Seat `turn` on move at any seating: on its own lead with the felt clear, having led a single
 * that every other seat passed, or under `cards` led by the seat before it and passed by the rest.
 */
export function seatedSituation(name: string, seats: 2 | 3 | 4, turn: number, cards?: string): Situation {
  const by = cards ? (turn + seats - 1) % seats : turn;
  const winner = (by + 1) % seats;
  const led = cards ?? "4_hearts";
  return {
    name,
    seats,
    mode: "free_for_all",
    opening: exchange(winner, by),
    holding: { [by]: `joker_colored ${led}`, [winner]: "3_clubs joker_bw" },
    moves: [giveback(winner, "3_clubs"), play(by, led), ...pass(...after(by, seats, cards ? seats - 2 : seats - 1))],
  };
}

const thrown = (name: string, turn: number, cards: string): Situation => seatedSituation(name, 4, turn, cards);

const PAIR = "K_hearts K_diamonds";

/**
 * Four lamp positions and two piles, one flown from the viewer and one from a
 * side seat, which is the smallest set that has ever caught anything. The turn is half of a state: the felt's pool, each seat's
 * ring and name and both action buttons all key off it, and
 * every capture taken before #205 was of the viewer's own turn — so the lamp
 * was only ever photographed at the bottom edge.
 */
export const CAPTURE_STATES: readonly CaptureState[] = [
  {
    id: "lamp-bottom",
    label: `${RIGHT} leads, you beat it and the rest pass — your lead, the lamp over your own hand`,
    playerCount: 4,
    turn: 0,
    side: "bottom",
    pile: false,
    situation: lampRound("lamp-bottom", 1),
  },
  {
    id: "lamp-right",
    label: `${TOP} leads, ${RIGHT} beats it and the rest pass — the lamp over the right seat`,
    playerCount: 4,
    turn: 1,
    side: "right",
    pile: false,
    situation: lampRound("lamp-right", 4),
  },
  {
    id: "lamp-top",
    label: `${LEFT} leads, ${TOP} beats it and the rest pass — the lamp over the top seat`,
    playerCount: 4,
    turn: 2,
    side: "top",
    pile: false,
    situation: lampRound("lamp-top", 3),
  },
  {
    id: "lamp-left",
    label: `You lead, ${LEFT} beats it and the rest pass — the lamp over the left seat`,
    playerCount: 4,
    turn: 3,
    side: "left",
    pile: false,
    situation: lampRound("lamp-left", 2),
  },
  {
    id: "pile-right",
    label: `You lead a pair, ${LEFT} and ${TOP} pass — the pile under ${RIGHT}'s lamp, not yours`,
    playerCount: 4,
    turn: 1,
    side: "right",
    pile: true,
    situation: thrown("pile-right", 1, PAIR),
  },
  {
    id: "play-right-landed",
    label: `${RIGHT} leads a pair, you and ${LEFT} pass — ${TOP} on move, the right seat's play landed on the pile`,
    playerCount: 4,
    turn: 2,
    side: "top",
    pile: true,
    situation: thrown("play-right-landed", 2, PAIR),
  },
  {
    id: "passed",
    label: `${LEFT} leads a pair, ${TOP} and ${RIGHT} pass — your move, PASSO beside the top seat's disc and under the right one's`,
    playerCount: 4,
    turn: 0,
    side: "bottom",
    pile: true,
    situation: thrown("passed", 0, PAIR),
  },
];

/** Dealt from the left seat, so the left seat and the viewer hold 14 and the other two 13. */
const COUNT_DEAL = { seats: 4, mode: "free_for_all", firstSeat: 3 } as const;

const STRAIGHT_TO_Q = "2_hearts 3_hearts 4_hearts 5_hearts 6_hearts 7_hearts 8_hearts 9_hearts 10_hearts J_hearts Q_diamonds";
const STRAIGHT_TO_K = "3_diamonds 4_diamonds 5_diamonds 6_diamonds 7_diamonds 8_diamonds 9_diamonds 10_diamonds J_diamonds Q_spades K_diamonds";
const STRAIGHT_TO_A = "4_clubs 5_clubs 6_clubs 7_clubs 8_clubs 9_clubs 10_clubs J_clubs Q_clubs K_clubs A_spades";
const TOP_RUN = "3_hearts 4_hearts 5_hearts 6_hearts 7_hearts 8_hearts 9_hearts 10_hearts J_hearts Q_hearts K_hearts A_diamonds";

/** The side seats each hold a straight of 11, the top seat one that beats both. */
const STRAIGHTS: Pick<Situation, "opening" | "holding"> = {
  opening: exchange(2, 1),
  holding: {
    0: "joker_bw 6_spades",
    1: `joker_colored ${STRAIGHT_TO_Q}`,
    2: `${STRAIGHT_TO_A} 3_clubs 4_spades`,
    3: `${STRAIGHT_TO_K} 5_spades`,
  },
};

const countState = (
  id: string,
  label: string,
  counts: CaptureState["counts"],
  situation: Omit<Situation, "name">
): CaptureState => ({
  id,
  label,
  playerCount: 4,
  turn: CAPTURE_VIEWER_SEAT,
  side: "bottom",
  pile: false,
  counts,
  situation: { name: id, ...situation },
});

/** Hands shrinking and a seat going out, the deal first: no seat ring and not the pile may move between them. */
export const SEAT_COUNT_STATES: readonly CaptureState[] = [
  countState("counts-13-13-13", `${LEFT} leads a single and you beat it — every opponent holds 13`, { right: 13, top: 13, left: 13 }, {
    ...COUNT_DEAL,
    opening: exchange(1, 3),
    holding: { 0: "joker_bw 5_hearts", 1: "3_hearts", 3: "joker_colored 4_hearts" },
    moves: [giveback(1, "3_hearts"), play(3, "4_hearts"), ...pass(2, 1), play(0, "5_hearts"), ...pass(3, 2, 1)],
  }),
  countState(
    "counts-2-13-2",
    `${RIGHT} and ${LEFT} each run a straight of 11, then ${LEFT} leads a single you beat — both side seats down to 2`,
    { right: 2, top: 13, left: 2 },
    {
      ...COUNT_DEAL,
      ...STRAIGHTS,
      moves: [
        giveback(2, "3_clubs"),
        play(1, STRAIGHT_TO_Q),
        ...pass(0),
        play(3, STRAIGHT_TO_K),
        ...pass(2, 1, 0),
        play(3, "5_spades"),
        ...pass(2, 1),
        play(0, "6_spades"),
        ...pass(3, 2, 1),
      ],
    }
  ),
  countState(
    "counts-2-1-2",
    `${RIGHT}, ${LEFT} and ${TOP} each run a straight of 11, then singles from ${TOP}, ${LEFT} and you — the top seat down to 1, the sides to 2`,
    { right: 2, top: 1, left: 2 },
    {
      ...COUNT_DEAL,
      ...STRAIGHTS,
      moves: [
        giveback(2, "3_clubs"),
        play(1, STRAIGHT_TO_Q),
        ...pass(0),
        play(3, STRAIGHT_TO_K),
        play(2, STRAIGHT_TO_A),
        ...pass(1, 0, 3),
        play(2, "4_spades"),
        ...pass(1, 0),
        play(3, "5_spades"),
        ...pass(2, 1),
        play(0, "6_spades"),
        ...pass(3, 2, 1),
      ],
    }
  ),
  countState(
    "counts-top-out",
    `${TOP} runs a straight of 12 and goes out on a single ${RIGHT} and you beat — its trophy on the ring`,
    { right: 13, top: "out", left: 13 },
    {
      seats: 4,
      mode: "free_for_all",
      opening: exchange(3, 2),
      holding: { 0: "joker_bw 5_clubs", 1: "4_clubs", 2: `joker_colored ${TOP_RUN}`, 3: "3_clubs" },
      moves: [
        giveback(3, "3_clubs"),
        play(2, TOP_RUN),
        ...pass(1, 0, 3),
        play(2, "3_clubs"),
        play(1, "4_clubs"),
        play(0, "5_clubs"),
        ...pass(3, 1),
      ],
    }
  ),
];

export const LINK_STATES: readonly CaptureState[] = [
  {
    id: "held",
    label: `You lead a pair, ${LEFT} and ${TOP} pass, and your link drops — the whole table held in grey`,
    playerCount: 4,
    turn: 1,
    side: "right",
    pile: true,
    link: "reconnecting",
    situation: thrown("held", 1, PAIR),
  },
];

/** Landing on the link that opens them, so a shot taken straight after it catches the moment mid-flight. */
const MOMENT_STATES: readonly CaptureState[] = [
  {
    id: "bomb-landed",
    label: `${RIGHT} leads a bomb, you and ${LEFT} pass — ${TOP} on move, the flare screening onto the felt`,
    playerCount: 4,
    turn: 2,
    side: "top",
    pile: "bomb",
    situation: thrown("bomb-landed", 2, "7_hearts 7_diamonds 7_clubs 7_spades"),
  },
];

export const ALL_CAPTURE_STATES: readonly CaptureState[] = [
  ...CAPTURE_STATES,
  ...SEAT_COUNT_STATES,
  ...LINK_STATES,
  ...MOMENT_STATES,
];

export function captureStateById(id: string | undefined): CaptureState | null {
  return ALL_CAPTURE_STATES.find((s) => s.id === id) ?? null;
}

/**
 * The table as a capture wants it, with the lobby's names seated.
 *
 * Nothing here advances the turn: `app/game.tsx` runs the bot turn loop, so a
 * seeded save with the turn on a bot is a bot's turn for about a second — long
 * enough to navigate to and not to photograph.
 */
export function captureGameState(state: CaptureState): GameState {
  const game = reach(state.situation);
  const bots = lobbyBots(state.playerCount);
  return {
    ...game,
    players: game.players.map((p, seat) => ({ ...p, name: seat === CAPTURE_VIEWER_SEAT ? VIEWER : bots[seat - 1] })),
  };
}

/** The same pile thrown by the next seat not on move, which the table flies and lands afresh. */
export function rethrow(state: GameState): GameState {
  const n = state.players.length;
  for (let step = 1; step < n; step++) {
    const seat = (state.lastPlayedBy + step) % n;
    if (seat !== state.currentTurnIndex) return { ...state, lastPlayedBy: seat };
  }
  return state;
}

/** The seat the lamp moves to when a capture asks for the swing. */
export function nextTurn(state: GameState): number {
  return (state.currentTurnIndex + 1) % state.players.length;
}
