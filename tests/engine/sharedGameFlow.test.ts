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
import type { Card, LastMove } from "../../lib/game/gameEngine.ts";
import type { ViewedGameState, WireExchangePhase } from "../../shared/protocol.ts";

const ACE: Card = { id: "a", rank: "A", suit: "spades", isJoker: false };
const THREE: Card = { id: "b", rank: "3", suit: "hearts", isJoker: false };
const PLAYERS = [{ name: "Ana" }, { name: "Bep" }, { name: "Cim" }];

test("names come from the seats, and both cards ride along", () => {
  assert.deepEqual(
    buildExchangeAnnounce(PLAYERS, { kind: "settled", winnerIdx: 2, loserIdx: 0 }, { given: ACE, received: THREE }),
    {
      winnerName: "Cim",
      loserName: "Ana",
      winnerIdx: 2,
      loserIdx: 0,
      twoJokers: false,
      cardGiven: ACE,
      cardReceived: THREE,
    }
  );
});

test("a seat with nobody in it names nobody, rather than undefined", () => {
  // The banner puts this straight into a <Text>. `undefined` renders as
  // nothing on web and throws on native, so the empty string is the contract.
  const announce = buildExchangeAnnounce(PLAYERS, { kind: "open", winnerIdx: 9, loserIdx: -1 });
  assert.equal(announce.winnerName, "");
  assert.equal(announce.loserName, "");
});

test("the both-jokers exception is carried, not inferred", () => {
  const announce = buildExchangeAnnounce(PLAYERS, { kind: "twoJokers", winnerIdx: 0, loserIdx: 1 });
  assert.equal(announce.twoJokers, true);
  // Neither card exists in that case; the banner reads the flag instead.
  assert.equal(announce.cardGiven, undefined);
  assert.equal(announce.cardReceived, undefined);
});

test("the seats survive two players sharing a name", () => {
  const twins = [{ name: "Ana" }, { name: "Ana" }];
  const announce = buildExchangeAnnounce(twins, { kind: "open", winnerIdx: 1, loserIdx: 0 });
  assert.equal(announce.winnerIdx, 1);
  assert.equal(announce.loserIdx, 0);
});

const DEAL: LastMove = { seq: 0, kind: "deal" };
const GIVE: LastMove = { seq: 1, kind: "giveback", seat: 2 };
const PLAY: LastMove = { seq: 2, kind: "play", seat: 1 };
const OUT: LastMove = { seq: 20, kind: "play", seat: 0 };
const state = (exchangePhase: WireExchangePhase | undefined, lastMove: LastMove, roundOver = false): ViewedGameState =>
  ({ players: PLAYERS, exchangePhase, roundOver, lastMove }) as unknown as ViewedGameState;
const SEATS = { winnerIdx: 2, loserIdx: 0 };
const open: WireExchangePhase = { kind: "open", ...SEATS, cardFromLoser: THREE };
const settledOffline = { kind: "settled", ...SEATS, cardFromLoser: THREE, cardToLoser: ACE } as const;
const settled = (cardToLoser?: Card): WireExchangePhase => ({ kind: "settled", ...SEATS, ...(cardToLoser && { cardToLoser }) });
const jokers: WireExchangePhase = { kind: "twoJokers", ...SEATS };
const announced = (cards: { given?: Card; received?: Card } = {}) =>
  buildExchangeAnnounce(PLAYERS, { kind: "settled", ...SEATS }, cards);
const jokersAnnounced = buildExchangeAnnounce(PLAYERS, jokers);
const same = state(jokers, DEAL);

// Online's closing state withholds `cardFromLoser`; offline's keeps it. The received card is read from `prev` in both.
const rows: [string, ViewedGameState | null, ViewedGameState, ReturnType<typeof exchangeAnnouncementOf>][] = [
  ["1 offline: the give closes the phase", state(open, DEAL), state(settledOffline, GIVE), announced({ received: THREE, given: ACE })],
  ["1 online: the give closes the phase", state(open, DEAL), state(settled(ACE), GIVE), announced({ received: THREE, given: ACE })],
  ["3: a two-joker deal seen first", null, state(jokers, DEAL), jokersAnnounced],
  ["4: a two-joker deal after a round over one", state(jokers, OUT, true), state(jokers, DEAL), jokersAnnounced],
  ["5: the two-joker round, a move later", state(jokers, DEAL), state(jokers, PLAY), null],
  ["6: an open phase re-sent", state(open, DEAL), state(open, DEAL), null],
  ["7: a closed phase, a move later", state(settled(ACE), GIVE), state(settled(ACE), PLAY), null],
  ["8: a fresh deal opening the phase", state(settled(), OUT, true), state(open, DEAL), null],
  ["8: a fresh deal opening the phase, none before", state(undefined, OUT, true), state(open, DEAL), null],
  ["9: the same state again", same, same, null],
  ["a two-joker round over, re-sent", state(jokers, OUT, true), state(jokers, OUT, true), null],
  ["a two-joker round over, seen first", null, state(jokers, OUT, true), jokersAnnounced],
  ["a two-joker deal after a round that ended on no move", state(settled(), DEAL, true), state(jokers, DEAL), jokersAnnounced],
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
      `${file} does not drive the ceremony from context/useExchangeAnnouncement.ts`
    );
    assert.equal(
      /useState[^\n]*\bexchangeAnnounc|setExchangeAnnouncing/i.test(source),
      false,
      `${file} holds the announcement again; the clock that ends it is now in two places`
    );
  }
});
