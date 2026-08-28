// tests/homeMenuModel.test.ts — one hero, and never the same way to play twice.
import { test } from "node:test";
import assert from "node:assert/strict";
import { homeMenu, type HomeAction } from "../components/homeMenuModel.ts";

const STATES = [
  { savedGame: false, account: false },
  { savedGame: false, account: true },
  { savedGame: true, account: false },
  { savedGame: true, account: true },
];

const describe = (s: { savedGame: boolean; account: boolean }) =>
  `${s.savedGame ? "a save" : "no save"}, ${s.account ? "signed in" : "signed out"}`;

test("the hero is never also a tile", () => {
  for (const state of STATES) {
    const menu = homeMenu(state);
    assert.ok(
      !menu.tiles.some((t) => t.action === menu.hero),
      `${describe(state)}: ${menu.hero} is offered as the hero and again in the grid`
    );
  }
});

test("every way to play is reachable, exactly once", () => {
  const ways: HomeAction[] = ["offline", "friends", "online", "passAndPlay"];
  for (const state of STATES) {
    const menu = homeMenu(state);
    const offered = [menu.hero, ...menu.tiles.map((t) => t.action)];
    for (const way of ways) {
      assert.equal(
        offered.filter((a) => a === way).length,
        1,
        `${describe(state)}: ${way} is offered ${offered.filter((a) => a === way).length} times`
      );
    }
  }
});

test("resume is the hero only when there is something to resume", () => {
  for (const state of STATES) {
    const menu = homeMenu(state);
    assert.equal(
      menu.hero === "resume",
      state.savedGame,
      `${describe(state)}: the hero is ${menu.hero}`
    );
    assert.ok(
      !menu.tiles.some((t) => t.action === "resume"),
      `${describe(state)}: resume appeared in the grid, where it can never be absent`
    );
  }
});

// The defect being fixed: signed out, these two silently redirected to /auth.
// Disabled with a reason is the whole point, so "not disabled" and "disabled
// but still routes" are the same bug.
test("signed out, the account-only ways are disabled rather than routed", () => {
  const menu = homeMenu({ savedGame: true, account: false });
  for (const action of ["friends", "online"] as HomeAction[]) {
    const tile = menu.tiles.find((t) => t.action === action);
    assert.ok(tile, `${action} is not offered at all when signed out`);
    assert.equal(tile.disabled, true, `${action} is live for a player with no account`);
  }
  assert.equal(
    menu.tiles.find((t) => t.action === "offline")?.disabled,
    false,
    "offline play was disabled for want of an account it does not need"
  );
});

test("signed in, nothing is disabled", () => {
  for (const savedGame of [false, true]) {
    const menu = homeMenu({ savedGame, account: true });
    assert.deepEqual(
      menu.tiles.filter((t) => t.disabled).map((t) => t.action),
      [],
      `signed in with ${savedGame ? "a save" : "no save"}: a tile was disabled anyway`
    );
  }
});

test("the hero states it leads to signing in, and only then", () => {
  assert.equal(homeMenu({ savedGame: false, account: false }).heroNeedsAccount, true);
  assert.equal(homeMenu({ savedGame: false, account: true }).heroNeedsAccount, false);
  // A save is an offline game: resuming it needs no account, so the hero must
  // not ask for one.
  assert.equal(homeMenu({ savedGame: true, account: false }).heroNeedsAccount, false);
});
