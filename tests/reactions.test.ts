// tests/reactions.test.ts — the reaction store's own contract.
//
// Reactions live outside OnlineGameContext so that an emoji cannot re-render
// the table (tests/native/reactionIsolation.test.tsx pins that half). What is
// checked here is everything the context used to do for them and now does not:
// each one expires on its own, a burst cannot pile up without bound, and
// leaving a table cancels the pending removals instead of leaking timers that
// fire into the next one.
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  REACTION_TTL_MS,
  clearReactions,
  pushReaction,
  readReactions,
  subscribeToReactions,
} from "../lib/reactions.ts";

const emoji = (n: number) => ({ emoji: "🔥", username: `p${n}`, fromSeat: n % 4 });

/** The store is module state, so every test starts from an empty felt. */
function fresh(t: TestContext) {
  clearReactions();
  t.mock.timers.enable({ apis: ["setTimeout"] });
}

test("a reaction is on the felt until its time is up, then gone", (t) => {
  fresh(t);
  pushReaction(emoji(1));
  assert.equal(readReactions().length, 1);

  t.mock.timers.tick(REACTION_TTL_MS - 1);
  assert.equal(readReactions().length, 1, "removed early");

  t.mock.timers.tick(1);
  assert.equal(readReactions().length, 0);
});

test("each reaction expires on its own clock", (t) => {
  fresh(t);
  pushReaction(emoji(1));
  t.mock.timers.tick(REACTION_TTL_MS / 2);
  pushReaction(emoji(2));

  t.mock.timers.tick(REACTION_TTL_MS / 2);
  assert.equal(readReactions().length, 1, "the older one leaves, the newer one stays");
  t.mock.timers.tick(REACTION_TTL_MS / 2);
  assert.equal(readReactions().length, 0);
});

test("a burst rolls off the oldest rather than piling up", (t) => {
  fresh(t);
  // The server allows 8 per 10s per seat, so four seats can send this many
  // well inside one reaction's lifetime.
  for (let i = 0; i < 32; i++) pushReaction(emoji(i));
  const shown = readReactions();
  assert.equal(shown.length, 10);
  assert.equal(shown.at(-1)!.username, "p31", "the newest must be the one kept");
});

test("the snapshot only changes identity when the list does", (t) => {
  fresh(t);
  const before = readReactions();
  assert.equal(readReactions(), before, "a new array per read re-renders subscribers forever");

  pushReaction(emoji(1));
  assert.notEqual(readReactions(), before);
});

test("leaving the table empties the felt and cancels the pending removals", (t) => {
  fresh(t);
  pushReaction(emoji(1));
  clearReactions();
  assert.equal(readReactions().length, 0);

  // The removal timer must be gone, not merely harmless: left running it fires
  // into whatever table is on screen by then.
  let notifications = 0;
  const unsubscribe = subscribeToReactions(() => {
    notifications++;
  });
  t.mock.timers.tick(REACTION_TTL_MS * 2);
  unsubscribe();
  assert.equal(notifications, 0, "a cancelled reaction still notified its subscribers");
});

test("subscribers are told about a push and about its removal", (t) => {
  fresh(t);
  let notifications = 0;
  const unsubscribe = subscribeToReactions(() => {
    notifications++;
  });

  pushReaction(emoji(1));
  assert.equal(notifications, 1);
  t.mock.timers.tick(REACTION_TTL_MS);
  assert.equal(notifications, 2);

  unsubscribe();
  pushReaction(emoji(2));
  assert.equal(notifications, 2, "an unsubscribed listener was still called");
});
