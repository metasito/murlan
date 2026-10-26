// tests/engine/matchState.test.ts — the seat a finished round or match celebrates.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { celebratesViewer, isDrawnRound, roundOutcomeFor, matchOutcomeFor, scoredOutcome } from "../../lib/game/matchState.ts";
import { autoMoveForSeat, chooseMove, offlineBotMove } from "../../lib/game/autoMove.ts";
import { pickGivebackCard } from "../../lib/game/bot.ts";
import { advance, dealNext, freshMatch, startTable } from "../../lib/game/matchFlow.ts";
import { emptyRankTally, startRound, type Card, type GameState, type PlayerType } from "../../lib/game/gameEngine.ts";
import { card as pc, seat as makeSeat, state as makeState } from "../support/game.ts";
import { playRoundOut } from "../support/moves.ts";

const TABLE = [
  { id: "player_0", name: "Alice", team: "A" },
  { id: "player_1", name: "Bob", team: "B" },
  { id: "player_2", name: "Carl", team: "A" },
];

describe("celebratesViewer", () => {
  test("reads the first candidate that names a seat", () => {
    assert.equal(celebratesViewer(TABLE, ["player_1", "player_0"], "player_1", false), true);
    assert.equal(celebratesViewer(TABLE, ["player_1", "player_0"], "player_0", false), false);
  });

  // A client that rejoins a table which finished while it was away never
  // receives `game:round_over`, so it holds `over: true` with no winners at all.
  test("passes over an undefined candidate", () => {
    assert.equal(celebratesViewer(TABLE, [undefined, "player_2"], "player_2", false), true);
  });

  // The winner id outliving the seat it named is the same shape as the hole
  // above, and the one a `find(c => c !== undefined)` would swallow: the
  // candidate is present, so the fallback behind it never gets its turn.
  test("passes over a candidate that names no seat", () => {
    assert.equal(celebratesViewer(TABLE, ["player_9", "player_0"], "player_0", false), true);
  });

  test("celebrates the winner's teammate in team mode only", () => {
    assert.equal(celebratesViewer(TABLE, ["player_0"], "player_2", true), true);
    assert.equal(celebratesViewer(TABLE, ["player_0"], "player_2", false), false);
    assert.equal(celebratesViewer(TABLE, ["player_0"], "player_1", true), false);
  });

  test("celebrates nobody when no candidate names a seat, or the viewer holds none", () => {
    assert.equal(celebratesViewer(TABLE, [undefined, "player_9"], "player_0", false), false);
    assert.equal(celebratesViewer(TABLE, ["player_0"], undefined, false), false);
  });
});

// GAME-RULES.md §11: first-and-fourth (3+0) pays the same total as second-and-
// third (2+1), so a round can end with both teams tied.
describe("isDrawnRound", () => {
  const TEAMS_TABLE = [
    { id: "player_0", team: "A" },
    { id: "player_1", team: "B" },
    { id: "player_2", team: "B" },
    { id: "player_3", team: "A" },
  ];

  test("first-and-fourth against second-and-third is a draw", () => {
    const placementPoints = { player_0: 3, player_1: 2, player_2: 1, player_3: 0 };
    assert.equal(isDrawnRound(TEAMS_TABLE, placementPoints), true);
  });

  test("a team that placed both members ahead is not a draw", () => {
    const placementPoints = { player_0: 3, player_1: 1, player_2: 0, player_3: 2 };
    assert.equal(isDrawnRound(TEAMS_TABLE, placementPoints), false);
  });

  test("a table with no team assignment is never a draw", () => {
    const placementPoints = { player_0: 3, player_1: 2, player_2: 1, player_3: 0 };
    assert.equal(
      isDrawnRound(
        TEAMS_TABLE.map(({ id }) => ({ id })),
        placementPoints
      ),
      false
    );
  });

  // Online, a round's finishingOrder reach the client before its scores do — an
  // empty or partial score set totals every team to zero, which is not the
  // same fact as every team scoring the same. "Not known yet" must read as
  // not-a-draw, or a round whose scores just haven't arrived reports the same
  // answer as one that genuinely tied.
  test("an absent score set is not a draw", () => {
    assert.equal(isDrawnRound(TEAMS_TABLE, {}), false);
  });

  test("a partial score set — some seats not scored yet — is not a draw", () => {
    const placementPoints = { player_0: 3, player_1: 2 };
    assert.equal(isDrawnRound(TEAMS_TABLE, placementPoints), false);
  });
});

describe("roundOutcomeFor", () => {
  const TEAMS_TABLE = [
    { id: "player_0", team: "A" },
    { id: "player_1", team: "B" },
    { id: "player_2", team: "B" },
    { id: "player_3", team: "A" },
  ];
  // First-and-fourth (3+0) against second-and-third (2+1): a draw.
  const drawnFinishingOrder = ["player_0", "player_1", "player_2", "player_3"];
  const drawnScores = { player_0: 3, player_1: 2, player_2: 1, player_3: 0 };

  test("is a draw for every seat on a drawn teams round", () => {
    for (const { id } of TEAMS_TABLE) {
      assert.equal(roundOutcomeFor(TEAMS_TABLE, drawnFinishingOrder, drawnScores, id, true), "draw");
    }
  });

  test("is won for the team that placed first-and-third, not just the seat that placed first", () => {
    const finishingOrder = ["player_0", "player_1", "player_3", "player_2"];
    const scores = { player_0: 3, player_1: 2, player_3: 1, player_2: 0 };
    assert.equal(roundOutcomeFor(TEAMS_TABLE, finishingOrder, scores, "player_0", true), "won");
    assert.equal(roundOutcomeFor(TEAMS_TABLE, finishingOrder, scores, "player_3", true), "won");
    assert.equal(roundOutcomeFor(TEAMS_TABLE, finishingOrder, scores, "player_1", true), "lost");
    assert.equal(roundOutcomeFor(TEAMS_TABLE, finishingOrder, scores, "player_2", true), "lost");
  });

  test("in free-for-all, only the seat that placed first or last gets an outcome", () => {
    const finishingOrder = ["player_2", "player_0", "player_1", "player_3"];
    const scores = { player_2: 3, player_0: 2, player_1: 1, player_3: 0 };
    assert.equal(roundOutcomeFor(TEAMS_TABLE, finishingOrder, scores, "player_2", false), "won");
    assert.equal(roundOutcomeFor(TEAMS_TABLE, finishingOrder, scores, "player_3", false), "lost");
    assert.equal(roundOutcomeFor(TEAMS_TABLE, finishingOrder, scores, "player_0", false), "neutral");
    assert.equal(roundOutcomeFor(TEAMS_TABLE, finishingOrder, scores, "player_1", false), "neutral");
  });

  test("is neutral for a spectator holding no seat", () => {
    assert.equal(roundOutcomeFor(TEAMS_TABLE, drawnFinishingOrder, drawnScores, undefined, true), "neutral");
  });

  test("is neutral before any round has a finish order", () => {
    assert.equal(roundOutcomeFor(TEAMS_TABLE, [], {}, "player_0", true), "neutral");
  });

  // `isTeamMode` is what gates the draw suppression on a table that merely
  // carries `.team` fields — free-for-all seats never do, which is what made
  // this guard look removable without reddening anything: nothing exercised
  // a non-teams table where `.team` happened to be set anyway.
  test("the isTeamMode guard actually gates the draw check", () => {
    assert.equal(
      roundOutcomeFor(TEAMS_TABLE, drawnFinishingOrder, drawnScores, "player_0", false),
      "won"
    );
  });

  // Online, `finishingOrder` reaches the client (`game:state`, roundOver: true) a
  // render ahead of `placementPoints` (the separate `game:round_over`) — the caller
  // (components/useTableFeedback.ts) has to be able to tell "not decided
  // yet" apart from "draw" so it knows to wait for the
  // render the scores arrive on instead of latching a decision made with
  // none.
  test("is pending in team mode when the round has a finish order but no scores yet", () => {
    assert.equal(roundOutcomeFor(TEAMS_TABLE, drawnFinishingOrder, {}, "player_0", true), "pending");
  });

  // Free-for-all never reads placementPoints at all — an absent score set must
  // not stall a mode that was never waiting on one.
  test("free-for-all is never pending, even with no scores at all", () => {
    assert.equal(roundOutcomeFor(TEAMS_TABLE, drawnFinishingOrder, {}, "player_0", false), "won");
  });
});

// The sting is latched once, so it waits for every ranked id's score in every mode: online, that is
// also when a match's winners have arrived, and a match-ending round must not sting as a round.
describe("scoredOutcome", () => {
  const order = ["player_0", "player_1"];

  test("holds a free-for-all outcome at pending until every ranked id is scored", () => {
    assert.equal(scoredOutcome("won", order, {}), "pending");
    assert.equal(scoredOutcome("won", order, { player_0: 3 }), "pending");
    assert.equal(scoredOutcome("won", order, { player_0: 3, player_1: 0 }), "won");
  });

  test("a round nobody finished has nothing to wait for", () => {
    assert.equal(scoredOutcome("neutral", [], {}), "neutral");
  });
});

describe("matchOutcomeFor", () => {
  const FREE_TABLE = [{ id: "player_0" }, { id: "player_1" }, { id: "player_2" }];
  const TEAMS_TABLE = [
    { id: "player_0", team: "A" },
    { id: "player_1", team: "B" },
    { id: "player_2", team: "B" },
    { id: "player_3", team: "A" },
  ];

  test("a drawn match is the same draw for every co-winner, whichever is listed first", () => {
    for (const winners of [["player_0", "player_2"], ["player_2", "player_0"]]) {
      assert.equal(matchOutcomeFor(FREE_TABLE, winners, "player_0", false), "draw");
      assert.equal(matchOutcomeFor(FREE_TABLE, winners, "player_2", false), "draw");
      assert.equal(matchOutcomeFor(FREE_TABLE, winners, "player_1", false), "lost");
    }
  });

  test("a teams match listing both partners is won by each of them", () => {
    const winners = ["player_3", "player_0"];
    assert.equal(matchOutcomeFor(TEAMS_TABLE, winners, "player_0", true), "won");
    assert.equal(matchOutcomeFor(TEAMS_TABLE, winners, "player_3", true), "won");
    assert.equal(matchOutcomeFor(TEAMS_TABLE, winners, "player_1", true), "lost");
  });

  test("is pending until its winners are known, and neutral for a spectator", () => {
    assert.equal(matchOutcomeFor(FREE_TABLE, [], "player_0", false), "pending");
    assert.equal(matchOutcomeFor(FREE_TABLE, ["player_0"], undefined, false), "neutral");
  });
});

describe("offlineBotMove", () => {
  const card = (id: string): Card => ({ id, rank: "9", suit: id === "9s" ? "spades" : "hearts", isJoker: false });
  const leading = (type: PlayerType): GameState => ({
    players: [
      { id: "player_0", name: "Bot", type, hand: [card("9s"), card("9h")] },
      { id: "player_1", name: "You", type: "human", hand: [{ ...card("4s"), rank: "4" }] },
    ],
    currentTurnIndex: 0,
    lastPlayedCombination: null,
    lastPlayedBy: -1,
    passCount: 0,
    gameMode: "free_for_all",
    roundOver: false,
    finishingOrder: [],
    openingCard: null,
    lastMove: { seq: 0, kind: "deal" },
    playedRanks: emptyRankTally(),
  });

  test("plays a bot at full strength, not the floor an AFK human gets", () => {
    const state = leading("bot");
    const floor = autoMoveForSeat(state, 0, "floor")!.state.lastPlayedCombination!.cards.map((c) => c.id);
    const played = offlineBotMove(state)?.state.lastPlayedCombination?.cards.map((c) => c.id);
    assert.equal(floor.length, 1);
    assert.deepEqual(played?.toSorted(), ["9h", "9s"], "the bot finishes with the pair; the floor would lead one card");
  });

  test("leaves a human's turn alone", () => {
    assert.equal(offlineBotMove(leading("human")), null);
  });

  // The e2e hook `murlanBotMove` calls this whenever a spec asks, round over or not.
  test("answers null, never a throw, when the round is over", () => {
    assert.equal(offlineBotMove({ ...leading("bot"), roundOver: true }), null);
    assert.equal(autoMoveForSeat({ ...leading("bot"), roundOver: true }, 0, "bot"), null);
  });
});

describe("chooseMove", () => {
  const openExchange = (): GameState =>
    makeState({
      players: [
        makeSeat(0, [pc("4", "clubs"), pc("9", "hearts")], { type: "bot" }),
        makeSeat(1, [pc("5", "clubs"), pc("7", "spades")], { type: "bot" }),
      ],
      currentTurnIndex: 0,
      exchangePhase: { kind: "open", winnerIdx: 1, loserIdx: 0, cardFromLoser: pc("2", "spades") },
    });

  test("an open exchange asks only its winner, for the card the bot would give back", () => {
    const state = openExchange();
    const expected = pickGivebackCard(state.players[1].hand, "2_spades")!.id;
    for (const strength of ["bot", "floor"] as const) {
      assert.deepEqual(chooseMove(state, 1, strength), { kind: "giveback", cardId: expected });
      assert.equal(chooseMove(state, 0, strength), null, "the loser has nothing to give while the winner is asked");
    }
  });

  test("a round that is over has no move for any seat", () => {
    const live = makeState({ players: [makeSeat(0, [pc("9", "hearts")]), makeSeat(1, [pc("4", "clubs")])] });
    assert.ok(chooseMove(live, 0, "floor"));
    assert.equal(chooseMove({ ...live, roundOver: true }, 0, "floor"), null);
    assert.equal(chooseMove({ ...live, roundOver: true }, 0, "bot"), null);
  });

  test("a seat off turn has no move", () => {
    const state = makeState({
      players: [makeSeat(0, [pc("9", "hearts")]), makeSeat(1, [pc("4", "clubs")])],
      currentTurnIndex: 0,
    });
    for (const strength of ["bot", "floor"] as const) {
      assert.equal(chooseMove(state, 1, strength), null);
      assert.ok(chooseMove(state, 0, strength));
    }
  });

  test("a seat on turn with no cards has no move, leading or not", () => {
    const players = [makeSeat(0, []), makeSeat(1, [pc("4", "clubs")])];
    const leading = makeState({ players, currentTurnIndex: 0 });
    const responding = makeState({
      players,
      currentTurnIndex: 0,
      lastPlayedBy: 1,
      lastPlayedCombination: { type: "single", cards: [pc("3", "hearts")], strength: 0 } as GameState["lastPlayedCombination"],
    });
    for (const strength of ["bot", "floor"] as const) {
      assert.equal(chooseMove(leading, 0, strength), null);
      assert.equal(chooseMove(responding, 0, strength), null);
    }
  });

  test("the floor leads its lowest card and passes once it is not leading", () => {
    const hand = [pc("K", "hearts"), pc("5", "clubs"), pc("9", "spades")];
    const leading = makeState({ players: [makeSeat(0, hand), makeSeat(1, [pc("4", "clubs")])] });
    assert.deepEqual(chooseMove(leading, 0, "floor"), { kind: "play", cardIds: ["5_clubs"] });
    const responding = makeState({
      players: [makeSeat(0, hand), makeSeat(1, [pc("4", "clubs")])],
      lastPlayedBy: 1,
      lastPlayedCombination: { type: "single", cards: [pc("3", "hearts")], strength: 0 } as GameState["lastPlayedCombination"],
    });
    assert.deepEqual(chooseMove(responding, 0, "floor"), { kind: "pass" });
  });
});

describe("offlineBotMove and the exchange", () => {
  test("acts for the exchange winner when that seat is a bot, whoever's turn the state names", () => {
    const state = makeState({
      players: [
        makeSeat(0, [pc("4", "clubs")], { type: "human" }),
        makeSeat(1, [pc("5", "clubs"), pc("7", "spades")], { type: "bot" }),
      ],
      currentTurnIndex: 0,
      exchangePhase: { kind: "open", winnerIdx: 1, loserIdx: 0, cardFromLoser: pc("2", "spades") },
    });
    const auto = offlineBotMove(state);
    assert.equal(auto?.move.kind, "giveback");
    assert.equal(auto?.state.exchangePhase?.kind, "settled");
  });

  test("leaves the exchange alone when its winner is a human", () => {
    const state = makeState({
      players: [
        makeSeat(0, [pc("4", "clubs")], { type: "bot" }),
        makeSeat(1, [pc("5", "clubs"), pc("7", "spades")], { type: "human" }),
      ],
      currentTurnIndex: 0,
      exchangePhase: { kind: "open", winnerIdx: 1, loserIdx: 0, cardFromLoser: pc("2", "spades") },
    });
    assert.equal(offlineBotMove(state), null);
  });
});

describe("the offline table (matchFlow)", () => {
  const seats = [
    { name: "A", type: "bot" as const },
    { name: "B", type: "bot" as const },
    { name: "C", type: "bot" as const },
  ];
  const finished = (table: ReturnType<typeof startTable>) => {
    const states = playRoundOut(table.state);
    return states[states.length - 1];
  };

  test("a fresh match has played nothing and is not over", () => {
    const match = freshMatch("match", 3);
    assert.deepEqual(match.rounds, []);
    assert.deepEqual(match.scores, {});
    assert.deepEqual(match.winners, []);
    assert.equal(match.over, false);
    assert.equal(match.isDraw, false);
  });

  test("the first deal starts from seat 0", () => {
    const table = startTable(seats, "free_for_all", "match");
    assert.equal(table.dealFirstSeat, 0);
    let askedFor: number | null = null;
    const dealt = startRound(seats, "free_for_all", { firstSeat: 0 });
    startTable(seats, "free_for_all", "match", {
      deal: (first) => {
        askedFor = first;
        return dealt;
      },
    });
    assert.equal(askedFor, 0);
  });

  test("advance scores a round once, when it ends, and leaves the match untouched otherwise", () => {
    const table = startTable(seats, "free_for_all", "match");
    const mid = playRoundOut(table.state)[3];
    assert.equal(mid.roundOver, false);
    assert.equal(advance(table, mid).match, table.match, "a live round scores nothing");

    const end = finished(table);
    const ended = advance(table, end);
    assert.equal(ended.match.rounds.length, 1);
    assert.deepEqual(ended.match.rounds[0].finishingOrder, end.finishingOrder);

    assert.equal(advance(ended, end).match, ended.match, "an already finished round is not scored twice");
  });

  test("dealNext keeps the same table while the round is live, and deals the next from one seat further", () => {
    const table = startTable(seats, "free_for_all", "match");
    assert.equal(dealNext(table), table);

    const ended = advance(table, finished(table));
    const next = dealNext(ended);
    assert.equal(next.state.roundOver, false);
    if (!ended.match.over) {
      assert.equal(next.dealFirstSeat, 1);
      assert.equal(next.match, ended.match);
    }
  });
});
