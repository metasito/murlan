// What the table says about an exchange: the turn pill's words and the note on the last-played pill.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  arrivingCard,
  exchangeNotes,
  INACTIVE_EXCHANGE,
  JOKERS,
  NO_STAGES,
  oneWayWords,
  readExchange,
  readExchangeLegs,
  readExchangeSeats,
  readHandArrival,
  type ExchangeStages,
} from "../../components/table/exchangeModel.ts";
import type { CardFrom } from "../../components/flightPose.ts";
import { arrangeOpponents } from "../../components/seatLayout.ts";
import { tableLayout } from "../../components/tableLayout.ts";
import { LEG, legPose, type LegStage } from "../../lib/timeline/exchangeTimeline.ts";
import { buildExchangeAnnounce } from "../../lib/game/sharedGameFlow.ts";
import type { Card, GameState, Player } from "../../lib/game/gameEngine.ts";
import type { TFn } from "../../lib/i18n.ts";

const t = ((key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key)) as TFn;
const SEVEN: Card = { id: "7h", rank: "7", suit: "hearts", isJoker: false };
const TWO: Card = { id: "2s", rank: "2", suit: "spades", isJoker: false };
const ACE: Card = { id: "As", rank: "A", suit: "spades", isJoker: false };
const PLAYERS = [{ name: "Ana" }, { name: "Bep" }, { name: "Cim" }] as GameState["players"];
const WINNER = 2;
const LOSER = 0;
const WATCHER = 1;

const phase = { kind: "open", winnerIdx: WINNER, loserIdx: LOSER, cardFromLoser: ACE } as const;
const openState = { players: PLAYERS, exchangePhase: phase } as unknown as GameState;
const receiving = buildExchangeAnnounce(PLAYERS, phase, { received: ACE });
const given = buildExchangeAnnounce(PLAYERS, phase, { received: ACE, given: SEVEN });
const stages = (s: Partial<ExchangeStages>): ExchangeStages => ({ key: "k", ...NO_STAGES, ...s });

const notes = (viewerSeat: number, over: Partial<Parameters<typeof exchangeNotes>[0]> = {}) =>
  exchangeNotes({
    shown: receiving,
    stages: stages({ receive: "rest" }),
    live: readExchange(openState, viewerSeat, false),
    players: PLAYERS,
    viewerSeat,
    spectating: false,
    t,
    ...over,
  });

test("nothing shown says nothing", () => {
  assert.deepEqual(notes(WINNER, { shown: null }), { chip: null, pillNote: null });
});

test("until the received card is read, the chip only names the exchange", () => {
  assert.equal(notes(WINNER).chip, "exchange.chipTitle");
});

test("the winner is asked to give to the loser, and told the card came to them", () => {
  const { chip, pillNote } = notes(WINNER, { stages: stages({ receive: "rest", ready: true }) });
  assert.equal(chip, 'exchange.chipGive {"name":"Ana"}');
  assert.deepEqual(pillNote, { text: 'exchange.pileGivesYou {"from":"Ana","card":"A♠"}', testID: "exchange-pill-note" });
});

test("the loser waits on the winner, and reads their own card as theirs", () => {
  const { chip, pillNote } = notes(LOSER, { stages: stages({ receive: "rest", ready: true }) });
  assert.equal(chip, 'exchange.waitingForYou {"winner":"Cim"}');
  assert.equal(pillNote?.text, 'exchange.pileYouGive {"card":"A♠","to":"Cim"}');
});

test("a watcher reads both seats in the third person", () => {
  for (const [seat, spectating] of [[WATCHER, false], [WINNER, true]] as const) {
    const { chip, pillNote } = notes(seat, {
      stages: stages({ receive: "rest", ready: true }),
      live: readExchange(openState, seat, spectating),
      spectating,
    });
    assert.equal(chip, 'exchange.watching {"winner":"Cim","loser":"Ana"}');
    assert.equal(pillNote?.text, 'exchange.pileGives {"from":"Ana","card":"A♠","to":"Cim"}');
  }
});

test("after the phase has closed, the winner's give still reads as theirs", () => {
  const { chip, pillNote } = notes(WINNER, { shown: given, stages: stages({ receive: "landed", give: "rest", ready: true }), live: INACTIVE_EXCHANGE });
  assert.equal(chip, "exchange.chipTitle");
  assert.deepEqual(pillNote, { text: 'exchange.pileYouGive {"card":"7♥","to":"Ana"}', testID: "exchange-pill-note" });
});

test("two jokers: no exchange, the jokers on the pile while they rest there", () => {
  const jokers = buildExchangeAnnounce(PLAYERS, { ...phase, kind: "twoJokers" });
  assert.deepEqual(notes(LOSER, { shown: jokers, live: INACTIVE_EXCHANGE }), {
    chip: "exchange.chipTitle",
    pillNote: { text: "exchangeAnnouncement.noExchangeText", testID: "exchange-pill-note" },
  });
  assert.equal(notes(LOSER, { shown: jokers, live: INACTIVE_EXCHANGE, stages: stages({ receive: "landed" }) }).pillNote, null);
});

test("a stuck release, with no give, leaves the pile bare once the receive has left it", () => {
  assert.equal(notes(WINNER, { stages: stages({ receive: "landed", give: "rest" }), live: INACTIVE_EXCHANGE }).pillNote, null);
});

describe("readExchange", () => {
  const players = [{ name: "A" }, { name: "B" }, { name: "C" }] as any[];
  const withPhase = (phase: any) => ({ players, exchangePhase: phase }) as any;

  test("no phase at all is not open", () => {
    assert.deepEqual(readExchange(withPhase(undefined), 0, false), INACTIVE_EXCHANGE);
  });

  test("a settled phase is not open", () => {
    assert.deepEqual(
      readExchange(withPhase({ kind: "settled", winnerIdx: 0, loserIdx: 2 }), 0, false),
      INACTIVE_EXCHANGE
    );
  });

  test("the winner is asked to give, the loser to wait", () => {
    const state = withPhase({ kind: "open", winnerIdx: 0, loserIdx: 2 });
    const asWinner = readExchange(state, 0, false);
    assert.equal(asWinner.viewerIsWinner, true);
    assert.equal(asWinner.viewerIsLoser, false);
    assert.equal(asWinner.winner, players[0]);
    assert.equal(asWinner.loser, players[2]);

    const asLoser = readExchange(state, 2, false);
    assert.equal(asLoser.viewerIsWinner, false);
    assert.equal(asLoser.viewerIsLoser, true);
  });

  test("a watcher is neither, whichever seat they are drawn from", () => {
    const state = withPhase({ kind: "open", winnerIdx: 0, loserIdx: 2 });
    for (const seat of [0, 1, 2]) {
      const v = readExchange(state, seat, true);
      assert.equal(v.open, true, `seat ${seat} still sees the phase`);
      assert.equal(v.viewerIsWinner, false, `seat ${seat} was called the winner`);
      assert.equal(v.viewerIsLoser, false, `seat ${seat} was called the loser`);
      assert.equal(v.winner, players[0], `seat ${seat} lost the winner's name`);
      assert.equal(v.loser, players[2], `seat ${seat} lost the loser's name`);
    }
  });

  test("a bystander is neither", () => {
    const v = readExchange(withPhase({ kind: "open", winnerIdx: 0, loserIdx: 2 }), 1, false);
    assert.equal(v.open, true);
    assert.equal(v.viewerIsWinner, false);
    assert.equal(v.viewerIsLoser, false);
  });

  test("an out-of-range seat resolves to null rather than undefined", () => {
    const v = readExchange(withPhase({ kind: "open", winnerIdx: 9, loserIdx: 2 }), 9, false);
    assert.equal(v.winner, null);
  });

  test("an open phase carries the card taken off the loser, for every viewer", () => {
    for (const [seat, spectating] of [[0, false], [2, false], [1, false], [0, true]] as const) {
      const v = readExchange(withPhase(phase), seat, spectating);
      assert.ok(v.open, `seat ${seat} does not see the phase open`);
      assert.deepEqual(v.cardFromLoser, ACE, `seat ${seat} lost the received card`);
    }
  });
});


describe("arrivingCard", () => {
  const GIVEN = { id: "6_clubs", suit: "clubs", rank: "6", isJoker: false } as const;
  const RECEIVED = { id: "2_spades", suit: "spades", rank: "2", isJoker: false } as const;
  const announce = {
    winnerName: "Ana",
    loserName: "Bea",
    winnerIdx: 1,
    loserIdx: 3,
    twoJokers: false, oneWay: false,
    cardGiven: GIVEN,
    cardReceived: RECEIVED,
  };

  // The two ends are not symmetric: each seat is receiving the other's card.
  test("the winner is receiving what was taken off the loser", () => {
    assert.deepEqual(arrivingCard(announce, 1), RECEIVED);
  });

  test("the loser is receiving what the winner chose", () => {
    assert.deepEqual(arrivingCard(announce, 3), GIVEN);
  });

  test("a seat outside the announced receives nothing", () => {
    for (const seat of [0, 2]) {
      assert.equal(arrivingCard(announce, seat), undefined, `seat ${seat} was given a card`);
    }
  });

  test("a spectator receives nothing", () => {
    assert.equal(arrivingCard(announce, null), undefined);
  });

  test("both Jokers cancelling the exchange delivers nothing to either seat", () => {
    const cancelled = { ...announce, twoJokers: true };
    for (const seat of [1, 3]) {
      assert.equal(arrivingCard(cancelled, seat), undefined, `seat ${seat} was given a card`);
    }
  });

  test("no ceremony, nothing arriving", () => {
    assert.equal(arrivingCard(null, 1), undefined);
    assert.equal(arrivingCard(undefined, 1), undefined);
  });

  test("neither seat is told the card it is giving away", () => {
    assert.notDeepEqual(arrivingCard(announce, 1), GIVEN);
    assert.notDeepEqual(arrivingCard(announce, 3), RECEIVED);
  });

  // Each exchanged card drawn in exactly one place: the hand, its flier, or the hand again (#650).
  describe("readHandArrival", () => {
    const KEPT = { id: "9_clubs", suit: "clubs", rank: "9", isJoker: false } as const;
    const choosing = { ...announce, cardGiven: undefined };
    const at = (receive: LegStage, give: LegStage = "waiting") => ({ ...NO_STAGES, key: "k", receive, give });
    const read = (over: Partial<Parameters<typeof readHandArrival>[0]>) =>
      readHandArrival({ hand: [KEPT, RECEIVED] as Card[], announced: announce, stages: at("waiting"), viewerSeat: 1, ...over });

    test("nothing is held back outside an exchange", () => {
      assert.deepEqual(read({ announced: null }), { withheldIds: [] });
    });

    test("the winner's hand keeps the card the engine already gave it out of the row until it lands", () => {
      for (const s of ["waiting", "flying", "rest", "tuck"] as const) {
        assert.deepEqual(read({ announced: choosing, stages: at(s) }).withheldIds, [RECEIVED.id], s);
      }
      assert.equal(read({ announced: choosing, stages: at("rest") }).arrivingIndex, undefined, "the row parts only for the tuck");
    });

    test("the tuck parts the row at the card's own place, and the landing gives it back to glow", () => {
      const tuck = read({ announced: choosing, stages: at("tuck") });
      assert.equal(tuck.arrivingIndex, 1);
      assert.equal(tuck.descendingId, RECEIVED.id);
      const landed = read({ announced: choosing, stages: at("landed") });
      assert.deepEqual(landed.withheldIds, []);
      assert.equal(landed.receivedId, RECEIVED.id);
      assert.equal(tuck.receivedId, undefined, "no glow before it is in the hand");
    });

    test("a card the hand does not hold parts nothing", () => {
      assert.equal(read({ announced: choosing, hand: [KEPT] as Card[], stages: at("tuck") }).arrivingIndex, undefined);
    });

    test("the card the winner gives stays in its hand until its leg lifts out of it", () => {
      const moved = [KEPT, RECEIVED] as Card[];
      assert.deepEqual(read({ hand: moved, stages: at("landed", "waiting") }).lent, GIVEN);
      assert.equal(read({ hand: moved, stages: at("landed", "flying") }).lent, undefined);
      const held = [KEPT, RECEIVED, GIVEN] as Card[];
      assert.deepEqual(read({ hand: held, stages: at("landed", "flying") }).withheldIds, [GIVEN.id]);
    });

    test("the loser lends the taken card until it lifts, then waits for the give", () => {
      const loser = (hand: Card[], receive: LegStage, give: LegStage) =>
        read({ hand, viewerSeat: 3, stages: at(receive, give) });
      assert.deepEqual(loser([KEPT] as Card[], "waiting", "waiting").lent, RECEIVED);
      assert.equal(loser([KEPT] as Card[], "flying", "waiting").lent, undefined);
      const after = [KEPT, GIVEN] as Card[];
      assert.deepEqual(loser(after, "landed", "rest").withheldIds, [GIVEN.id]);
      assert.equal(loser(after, "landed", "tuck").arrivingIndex, 1);
      assert.equal(loser(after, "landed", "landed").receivedId, GIVEN.id);
    });

    test("a bystander and a spectator are left alone", () => {
      assert.deepEqual(read({ viewerSeat: 0, stages: at("tuck") }), { withheldIds: [] });
      assert.deepEqual(read({ viewerSeat: null, stages: at("tuck") }), { withheldIds: [] });
    });

    test("both Jokers leave the loser's hand only while they are in the air", () => {
      const jokers = { ...announce, twoJokers: true };
      const hand = [KEPT, ...JOKERS] as Card[];
      const ids = (s: LegStage) => read({ announced: jokers, hand, viewerSeat: 3, stages: at(s) }).withheldIds;
      assert.deepEqual(ids("waiting"), []);
      assert.deepEqual(ids("rest"), JOKERS.map((c) => c.id));
      assert.deepEqual(ids("landed"), []);
    });
  });

  describe("readExchangeSeats", () => {
    const at = (receive: LegStage, give: LegStage = "waiting") => ({ ...NO_STAGES, key: "k", receive, give });
    const seats = (announced: Parameters<typeof readExchangeSeats>[0], receive: LegStage, give?: LegStage) => {
      const { lit, shift } = readExchangeSeats(announced, at(receive, give));
      return { lit: [...lit].sort(), shift: Object.fromEntries(shift) };
    };

    test("the giver lights from its card's first frame, the receiver from the rest, both out at the landing", () => {
      const choosing = { ...announce, cardGiven: undefined };
      assert.deepEqual(seats(choosing, "waiting").lit, []);
      assert.deepEqual(seats(choosing, "flying").lit, [3]);
      assert.deepEqual(seats(choosing, "rest").lit, [1, 3]);
      assert.deepEqual(seats(choosing, "tuck").lit, [1, 3]);
      assert.deepEqual(seats(choosing, "landed").lit, []);
      assert.deepEqual(seats(announce, "landed", "flying").lit, [1]);
    });

    test("each count shows the card where it is drawn, not where the engine moved it", () => {
      const choosing = { ...announce, cardGiven: undefined };
      assert.deepEqual(seats(choosing, "waiting").shift, { 1: -1, 3: 1 });
      assert.deepEqual(seats(choosing, "flying").shift, { 1: -1 });
      assert.deepEqual(seats(announce, "landed", "waiting").shift, { 1: 1, 3: -1 });
      assert.deepEqual(seats(announce, "landed", "rest").shift, { 3: -1 });
      assert.deepEqual(seats(announce, "landed", "landed").shift, {});
    });

    test("both Jokers light the loser and leave its fan while they fly", () => {
      const jokers = { ...announce, twoJokers: true };
      assert.deepEqual(seats(jokers, "rest"), { lit: [3], shift: { 3: -2 } });
      assert.deepEqual(seats(jokers, "landed"), { lit: [], shift: {} });
    });

    test("no announced marks nothing", () => {
      assert.deepEqual(seats(null, "rest"), { lit: [], shift: {} });
    });
  });
});

describe("readExchangeLegs", () => {
  const card = (id: string) =>
    ({ id, suit: "clubs", rank: "5", isJoker: false }) as Card;
  const seat = (id: string, cards: number) =>
    ({
      id,
      name: id,
      type: "bot",
      hand: Array.from({ length: cards }, (_, i) => card(`${id}_${i}`)),
    }) as unknown as Player;

  /** Four seats, the viewer at 0: 1 is right, 2 is top, 3 is left. */
  const players = [seat("me", 5), seat("right", 6), seat("top", 7), seat("left", 8)];

  const announced = (winnerIdx: number, loserIdx: number, twoJokers = false) => ({
    winnerName: "",
    loserName: "",
    winnerIdx,
    loserIdx,
    twoJokers,
    oneWay: false,
    cardReceived: card("taken"),
    cardGiven: card("given"),
  });
  const LAYOUT = tableLayout({ width: 844, height: 390, insets: { top: 0, bottom: 0, left: 0, right: 0 }, scale: 1 });
  const legs = (winnerIdx: number, loserIdx: number, table = players, origins?: Map<string, CardFrom>, jokers = false) =>
    readExchangeLegs(
      announced(winnerIdx, loserIdx, jokers),
      LAYOUT,
      { viewerSeat: 0, players: table, opponents: arrangeOpponents(table, 0) },
      origins
    );

  test("every leg rests face up on the pile's own centre, at a played card's size", () => {
    for (const [winner, loser] of [[0, 2], [1, 3], [2, 1], [3, 0]]) {
      const { receive, give } = legs(winner, loser);
      for (const leg of [receive, give]) {
        const p = legPose(LEG.rest, leg);
        assert.deepEqual({ x: p.x, y: p.y, scale: p.scale, face: p.face }, { x: 0, y: 0, scale: 1, face: true }, `${winner}>${loser}`);
      }
    }
  });

  test("both Jokers rest side by side on the pile and go back to the loser", () => {
    const { jokers } = legs(1, 3, players, undefined, true);
    assert.deepEqual(jokers.map((j) => j.rest.x), [-18, 18]);
    for (const j of jokers) assert.deepEqual(j.from, j.to, "they leave and return to the same fan");
  });

  test("the viewer's card leaves from, and never jumps off, its own place in the hand", () => {
    const own = new Map<string, CardFrom>([["taken", { x: -40, y: -6, rot: 4, scale: 1.1 }]]);
    const from = legs(2, 0, players, own).receive.from;
    const hand = LAYOUT.seatPoint("bottom");
    assert.deepEqual(from, { x: -40 + hand.dx, y: -6 + hand.dy, rot: 4, scale: 1.1 });
  });

  test("swapping who won swaps the two legs", () => {
    assert.deepEqual(legs(1, 3).receive, legs(3, 1).give);
  });

  test("the viewer's end is the hand, face up; an opponent's is its fan, a back", () => {
    const { receive } = legs(0, 2);
    assert.equal(receive.toFace, true);
    assert.equal(receive.fromFace, false);
  });

  test("a side seat's own hand places the card it exchanges", () => {
    const at = (leftCards: number) =>
      legs(3, 0, [seat("me", 5), seat("right", 6), seat("top", 7), seat("left", leftCards)]).receive.to;
    assert.notDeepEqual(at(1), at(13));
  });
});

describe("a spectator (null seat) owns no seat in the exchange", () => {
  const STAGES: LegStage[] = ["waiting", "flying", "rest", "tuck", "landed"];
  const hand = [TWO, ACE, SEVEN, ...JOKERS];
  const shapes = [0, 1, 2].flatMap((winnerIdx) =>
    [0, 1, 2]
      .filter((loserIdx) => loserIdx !== winnerIdx)
      .flatMap((loserIdx) =>
        [false, true].map((twoJokers) => ({
          winnerName: "",
          loserName: "",
          winnerIdx,
          loserIdx,
          twoJokers,
          oneWay: false,
          cardReceived: ACE,
          cardGiven: SEVEN,
        }))
      )
  );

  test("arrivingCard hands a spectator nothing", () => {
    for (const announce of shapes) assert.equal(arrivingCard(announce, null), undefined, JSON.stringify(announce));
  });

  test("readHandArrival holds back nothing for a spectator, at every stage", () => {
    for (const announced of shapes) {
      for (const receive of STAGES) {
        for (const give of STAGES) {
          assert.deepEqual(
            readHandArrival({ hand, announced, stages: { key: "k", receive, give, ready: false }, viewerSeat: null }),
            { withheldIds: [] },
            `${JSON.stringify(announced)} ${receive}/${give}`
          );
        }
      }
    }
  });

  test("the same seats, seated, do own them, so the sweep above can tell", () => {
    const seated = shapes.filter((a) => !a.twoJokers);
    assert.ok(seated.every((a) => arrivingCard(a, a.winnerIdx) === ACE && arrivingCard(a, a.loserIdx) === SEVEN));
    const lent = seated.map((a) =>
      readHandArrival({ hand, announced: a, stages: { key: "k", receive: "flying", give: "flying", ready: false }, viewerSeat: a.winnerIdx })
    );
    assert.ok(lent.every((r) => r.withheldIds.length > 0));
  });
});

test("the one-way words are composed in one place: who in the turn pill, why in the last-played pill, both when spoken", () => {
  assert.deepEqual(oneWayWords(t, { name: "Cim", isViewer: false }), {
    chip: 'exchange.chipOneWay {"name":"Cim"}',
    note: "exchange.pillNothing",
    spoken: 'exchange.chipOneWay {"name":"Cim"}. exchange.pillNothing',
  });
  assert.equal(oneWayWords(t, { name: "Cim", isViewer: true }).chip, "exchange.chipOneWayYou");
});

describe("a one-way exchange: the winner holds nothing to give back", () => {
  const oneWay = { ...buildExchangeAnnounce(PLAYERS, { kind: "settled", winnerIdx: WINNER, loserIdx: LOSER }, { received: ACE }), oneWay: true };
  const asked = (viewerSeat: number, over: Partial<Parameters<typeof exchangeNotes>[0]> = {}) =>
    notes(viewerSeat, { shown: oneWay, live: INACTIVE_EXCHANGE, ...over });

  test("the receive reads on the last-played pill as any other, in each viewer's own person", () => {
    assert.equal(asked(WINNER).pillNote?.text, 'exchange.pileGivesYou {"from":"Ana","card":"A♠"}');
    assert.equal(asked(LOSER).pillNote?.text, 'exchange.pileYouGive {"card":"A♠","to":"Cim"}');
    assert.equal(asked(WATCHER).pillNote?.text, 'exchange.pileGives {"from":"Ana","card":"A♠","to":"Cim"}');
    assert.equal(asked(WINNER).chip, "exchange.chipTitle");
  });

  test("once the receive is read, the turn pill names the winner one-way and the last-played pill says there is nothing to give back", () => {
    const read = { stages: stages({ receive: "landed", ready: true }) };
    for (const seat of [LOSER, WATCHER]) {
      assert.deepEqual(asked(seat, read), {
        chip: 'exchange.chipOneWay {"name":"Cim"}',
        pillNote: { text: "exchange.pillNothing", testID: "exchange-pill-note" },
      });
    }
    assert.equal(asked(WINNER, read).chip, "exchange.chipOneWayYou");
    assert.equal(asked(WINNER, read).pillNote?.text, "exchange.pillNothing");
    assert.equal(asked(WINNER, { ...read, spectating: true }).chip, 'exchange.chipOneWay {"name":"Cim"}');
  });

  test("between the receive leaving the pile and the choice's beat, the pills say nothing of it", () => {
    assert.equal(asked(WINNER, { stages: stages({ receive: "tuck" }) }).pillNote, null);
    assert.equal(asked(WINNER, { stages: stages({ receive: "landed" }) }).pillNote, null);
  });

  test("a two-way exchange never says it", () => {
    assert.equal(notes(WINNER, { stages: stages({ receive: "landed", ready: true }) }).pillNote, null);
  });
});
