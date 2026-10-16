// tests/engine/sharedGameFlow.test.ts — the announce both modes build.
//
// The banner is described the same way whether the exchange happened on a
// server or in this process, and the four places that described it wrote the
// same lookup out longhand. The lookup is the part worth pinning: a seat index
// that does not name a player has to become an empty string rather than
// `undefined`, because the banner renders the name either way.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildExchangeAnnounce, exchangeAnnouncementOf } from "../../lib/game/sharedGameFlow.ts";
import type { Card, ExchangePhase, GameState } from "../../lib/game/gameEngine.ts";

const ACE: Card = { id: "a", rank: "A", suit: "spades", isJoker: false };
const THREE: Card = { id: "b", rank: "3", suit: "hearts", isJoker: false };
const PLAYERS = [{ name: "Ana" }, { name: "Bep" }, { name: "Cim" }];

test("names come from the seats, and both cards ride along", () => {
  assert.deepEqual(
    buildExchangeAnnounce(PLAYERS, { winnerIdx: 2, loserIdx: 0 }, { given: ACE, received: THREE }),
    {
      winnerName: "Cim",
      loserName: "Ana",
      winnerIdx: 2,
      loserIdx: 0,
      twoJokerException: false,
      cardGiven: ACE,
      cardReceived: THREE,
    }
  );
});

test("a seat with nobody in it names nobody, rather than undefined", () => {
  // The banner puts this straight into a <Text>. `undefined` renders as
  // nothing on web and throws on native, so the empty string is the contract.
  const announce = buildExchangeAnnounce(PLAYERS, { winnerIdx: 9, loserIdx: -1 });
  assert.equal(announce.winnerName, "");
  assert.equal(announce.loserName, "");
});

test("the both-jokers exception is carried, not inferred", () => {
  const announce = buildExchangeAnnounce(PLAYERS, {
    winnerIdx: 0,
    loserIdx: 1,
    twoJokerException: true,
  });
  assert.equal(announce.twoJokerException, true);
  // Neither card exists in that case; the banner reads the flag instead.
  assert.equal(announce.cardGiven, undefined);
  assert.equal(announce.cardReceived, undefined);
});

test("the seats survive two players sharing a name", () => {
  const twins = [{ name: "Ana" }, { name: "Ana" }];
  const announce = buildExchangeAnnounce(twins, { winnerIdx: 1, loserIdx: 0 });
  assert.equal(announce.winnerIdx, 1);
  assert.equal(announce.loserIdx, 0);
});

const state = (exchangePhase: ExchangePhase | undefined, roundOver = false): GameState =>
  ({ players: PLAYERS, exchangePhase, roundOver }) as unknown as GameState;
const open = (cards: Partial<ExchangePhase> = {}): ExchangePhase =>
  ({ active: true, winnerIdx: 2, loserIdx: 0, twoJokerException: false, ...cards });
const closed = (cards: Partial<ExchangePhase> = {}): ExchangePhase => ({ ...open(cards), active: false });
const jokers: ExchangePhase = { active: false, winnerIdx: 2, loserIdx: 0, twoJokerException: true };
const announced = (cards: { given?: Card; received?: Card } = {}) =>
  buildExchangeAnnounce(PLAYERS, { winnerIdx: 2, loserIdx: 0 }, cards);
const jokersAnnounced = buildExchangeAnnounce(PLAYERS, jokers);
const same = state(jokers);

// Online's closing state withholds `cardFromLoser`; offline's keeps it. The received card is read from `prev` in both.
const rows: [string, GameState | null, GameState, ReturnType<typeof exchangeAnnouncementOf>][] = [
  ["1 offline: the give closes the phase", state(open({ cardFromLoser: THREE })), state(closed({ cardFromLoser: THREE, cardToLoser: ACE })), announced({ received: THREE, given: ACE })],
  ["1 online: the give closes the phase", state(open({ cardFromLoser: THREE })), state(closed({ cardToLoser: ACE })), announced({ received: THREE, given: ACE })],
  ["2: a stuck release closes it with no give", state(open({ cardFromLoser: THREE })), state(closed({ cardFromLoser: THREE })), announced({ received: THREE })],
  ["3: a two-joker deal seen first", null, state(jokers), jokersAnnounced],
  ["4: a two-joker deal after a round over one", state(jokers, true), state(jokers), jokersAnnounced],
  ["5: the two-joker round, a move later", state(jokers), state(jokers), null],
  ["6: an open phase re-sent", state(open({ cardFromLoser: THREE })), state(open({ cardFromLoser: THREE })), null],
  ["7: a closed phase, a move later", state(closed({ cardToLoser: ACE })), state(closed({ cardToLoser: ACE })), null],
  ["8: a fresh deal opening the phase", state(closed(), true), state(open({ cardFromLoser: THREE })), null],
  ["8: a fresh deal opening the phase, none before", state(undefined, true), state(open({ cardFromLoser: THREE })), null],
  ["9: the same state again", same, same, null],
  ["a two-joker round over, re-sent", state(jokers, true), state(jokers, true), null],
  ["a two-joker round over, seen first", null, state(jokers, true), null],
];

for (const [name, prev, next, expected] of rows) {
  test(`exchangeAnnouncementOf, row ${name}`, () => {
    assert.deepEqual(exchangeAnnouncementOf(prev, next), expected);
  });
}

/**
 * The point of the shared form: a change to the ceremony is one change.
 * Source-read, because what is being pinned is that the providers do not hold
 * their own — which is a property of the files, not of a render.
 */
test("neither provider keeps its own ceremony", () => {
  const root = new URL("../..", import.meta.url);
  for (const file of ["context/GameContext.tsx", "context/OnlineGameContext.tsx"]) {
    const source = readFileSync(new URL(file, root), "utf8");
    assert.ok(
      source.includes("useExchangeAnnouncement("),
      `${file} does not drive the ceremony from lib/game/sharedGameFlow.ts`
    );
    assert.equal(
      /useState[^\n]*\bexchangeAnnounc|setExchangeAnnouncing/i.test(source),
      false,
      `${file} holds the announcement again; the clock that ends it is now in two places`
    );
  }
});
