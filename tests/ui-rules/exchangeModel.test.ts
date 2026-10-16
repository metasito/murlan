// What the table says about an exchange: the chip and the note on the pile.
import { test } from "node:test";
import assert from "node:assert/strict";
import { exchangeNotes, INACTIVE_EXCHANGE, JOKERS, NO_STAGES, readExchange, type ExchangeStages } from "../../components/table/exchangeModel.ts";
import { buildExchangeAnnounce } from "../../lib/game/sharedGameFlow.ts";
import type { Card, GameState } from "../../lib/game/gameEngine.ts";
import type { TFn } from "../../lib/i18n.ts";

const t = ((key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key)) as TFn;
const SEVEN: Card = { id: "7h", rank: "7", suit: "hearts", isJoker: false };
const TWO: Card = { id: "2s", rank: "2", suit: "spades", isJoker: false };
const ACE: Card = { id: "As", rank: "A", suit: "spades", isJoker: false };
const PLAYERS = [{ name: "Ana" }, { name: "Bep" }, { name: "Cim" }] as GameState["players"];
const WINNER = 2;
const LOSER = 0;
const WATCHER = 1;

const phase = { active: true, winnerIdx: WINNER, loserIdx: LOSER, twoJokerException: false, cardFromLoser: ACE };
const openState = { players: PLAYERS, exchangePhase: phase } as unknown as GameState;
const receiving = buildExchangeAnnounce(PLAYERS, phase, { received: ACE });
const given = buildExchangeAnnounce(PLAYERS, phase, { received: ACE, given: SEVEN });
const stages = (s: Partial<ExchangeStages>): ExchangeStages => ({ key: "k", ...NO_STAGES, ...s });

const notes = (viewerSeat: number, over: Partial<Parameters<typeof exchangeNotes>[0]> = {}) =>
  exchangeNotes({
    shown: receiving,
    stages: stages({ receive: "rest" }),
    live: readExchange(openState, viewerSeat, false),
    giveable: undefined,
    players: PLAYERS,
    viewerSeat,
    spectating: false,
    t,
    ...over,
  });

test("nothing shown says nothing", () => {
  assert.deepEqual(notes(WINNER, { shown: null }), { chip: null, pileNote: null });
});

test("until the received card is read, the chip only names the exchange", () => {
  assert.equal(notes(WINNER).chip, "exchange.chipTitle");
});

test("the winner is asked to give to the loser, and told the card came to them", () => {
  const { chip, pileNote } = notes(WINNER, { stages: stages({ receive: "rest", ready: true }), giveable: [SEVEN] });
  assert.equal(chip, 'exchange.chipGive {"name":"Ana"}');
  assert.deepEqual(pileNote, { text: 'exchange.pileGivesYou {"from":"Ana","card":"A♠"}', testID: "exchange-pile-label", cards: [ACE] });
});

test("a winner holding nothing in 3-10 is told the fallback, not the rule", () => {
  assert.equal(notes(WINNER, { stages: stages({ ready: true }), giveable: [TWO] }).chip, "exchange.noValidCards");
});

test("the loser waits on the winner, and reads their own card as theirs", () => {
  const { chip, pileNote } = notes(LOSER, { stages: stages({ receive: "rest", ready: true }) });
  assert.equal(chip, 'exchange.waitingForYou {"winner":"Cim"}');
  assert.equal(pileNote?.text, 'exchange.pileYouGive {"card":"A♠","to":"Cim"}');
});

test("a watcher reads both seats in the third person", () => {
  for (const [seat, spectating] of [[WATCHER, false], [WINNER, true]] as const) {
    const { chip, pileNote } = notes(seat, {
      stages: stages({ receive: "rest", ready: true }),
      live: readExchange(openState, seat, spectating),
      spectating,
    });
    assert.equal(chip, 'exchange.watching {"winner":"Cim","loser":"Ana"}');
    assert.equal(pileNote?.text, 'exchange.pileGives {"from":"Ana","card":"A♠","to":"Cim"}');
  }
});

test("after the phase has closed, the winner's give still reads as theirs", () => {
  const { chip, pileNote } = notes(WINNER, { shown: given, stages: stages({ receive: "landed", give: "rest", ready: true }), live: INACTIVE_EXCHANGE });
  assert.equal(chip, "exchange.chipTitle");
  assert.deepEqual(pileNote, { text: 'exchange.pileYouGive {"card":"7♥","to":"Ana"}', testID: "exchange-pile-label", cards: [SEVEN] });
});

test("two jokers: no exchange, the jokers on the pile while they rest there", () => {
  const jokers = buildExchangeAnnounce(PLAYERS, { ...phase, twoJokerException: true });
  assert.deepEqual(notes(LOSER, { shown: jokers, live: INACTIVE_EXCHANGE }), {
    chip: "exchange.chipTitle",
    pileNote: { text: "exchangeAnnouncement.noExchangeText", testID: "exchange-none", cards: JOKERS },
  });
  assert.equal(notes(LOSER, { shown: jokers, live: INACTIVE_EXCHANGE, stages: stages({ receive: "landed" }) }).pileNote, null);
});

test("a stuck release, with no give, leaves the pile bare once the receive has left it", () => {
  assert.equal(notes(WINNER, { stages: stages({ receive: "landed", give: "rest" }), live: INACTIVE_EXCHANGE }).pileNote, null);
});
