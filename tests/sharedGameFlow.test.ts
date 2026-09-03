// tests/sharedGameFlow.test.ts — the announce both modes build.
//
// The banner is described the same way whether the exchange happened on a
// server or in this process, and the four places that described it wrote the
// same lookup out longhand. The lookup is the part worth pinning: a seat index
// that does not name a player has to become an empty string rather than
// `undefined`, because the banner renders the name either way.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildExchangeAnnounce, rematchPromptOpen } from "../lib/sharedGameFlow.ts";
import type { Card } from "../lib/gameEngine.ts";

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
      bothJokersException: false,
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
    bothJokersException: true,
  });
  assert.equal(announce.bothJokersException, true);
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

const MATCH = { length: "match" as const, target: 21, over: false };

test("no prompt without a game, once it is over, or once the match is", () => {
  const closing = { gameOver: false, handCounts: [1, 9, 9] };
  assert.equal(rematchPromptOpen(null, MATCH, {}), false, "there is no table to ask");
  assert.equal(
    rematchPromptOpen({ ...closing, gameOver: true }, MATCH, { p: 30 }),
    false,
    "the hand is over, so the result screen asks instead"
  );
  assert.equal(
    rematchPromptOpen(closing, { ...MATCH, over: true }, { p: 30 }),
    false,
    "the match is decided, so there is nothing to continue"
  );
});

test("asks once the manche is nearly out and the target is reachable", () => {
  assert.equal(
    rematchPromptOpen({ gameOver: false, handCounts: [1, 9, 9] }, MATCH, { p: 19 }),
    true
  );
  assert.equal(
    rematchPromptOpen({ gameOver: false, handCounts: [8, 9, 9] }, MATCH, { p: 19 }),
    false,
    "nobody is close to going out yet"
  );
  assert.equal(
    rematchPromptOpen({ gameOver: false, handCounts: [1, 9, 9] }, MATCH, { p: 2 }),
    false,
    "the target is out of reach from this manche, so it cannot be the last"
  );
});

test("the seat count comes from the hands, so the two cannot disagree", () => {
  // A single manche is the last by definition, so this isolates the count:
  // `matchIsClosing` refuses an empty table before it looks at anything else.
  const single = { length: "single" as const, target: 21, over: false };
  assert.equal(rematchPromptOpen({ gameOver: false, handCounts: [] }, single, {}), false);
  assert.equal(rematchPromptOpen({ gameOver: false, handCounts: [1] }, single, {}), true);
});

/**
 * The point of the shared forms: a change to the ceremony or the prompt is one
 * change. Source-read, because what is being pinned is that the providers do
 * not hold their own — which is a property of the files, not of a render.
 */
test("neither provider keeps its own ceremony or prompt", () => {
  const root = new URL("..", import.meta.url);
  for (const file of ["context/GameContext.tsx", "context/OnlineGameContext.tsx"]) {
    const source = readFileSync(new URL(file, root), "utf8");
    assert.ok(
      source.includes("useExchangeAnnouncement("),
      `${file} does not drive the ceremony from lib/sharedGameFlow.ts`
    );
    assert.equal(
      /useState[^\n]*\bexchangeAnnounc|setExchangeAnnouncing/i.test(source),
      false,
      `${file} holds the announcement again; the clock that ends it is now in two places`
    );
    assert.equal(
      /matchIsClosing\(/.test(source),
      false,
      `${file} derives the rematch prompt again rather than asking for it`
    );
  }
});
