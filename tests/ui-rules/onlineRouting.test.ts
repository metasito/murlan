import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NO_TABLE,
  lobbyFor,
  navigationFor,
  onlineRouteOf,
  type OnlineFacts,
} from "../../context/onlineRouting.ts";

const room = (roomId = "r1"): OnlineFacts => ({ ...NO_TABLE, roomId });
const seated = (roomId = "r1"): OnlineFacts => ({ ...NO_TABLE, roomId, hasGame: true });
const watching: OnlineFacts = { ...NO_TABLE, hasGame: true, isSpectator: true };
const refused: OnlineFacts = { ...NO_TABLE, rejoinFailed: true };

test("a room that appears replaces quickmatch and is pushed from anywhere else", () => {
  assert.deepEqual(navigationFor(NO_TABLE, room(), "quickmatch", "quickmatch"), {
    kind: "replace",
    to: "/(online)/room",
  });
  for (const here of ["lobby", "other"] as const) {
    assert.deepEqual(navigationFor(NO_TABLE, room(), here, "friends"), { kind: "push", to: "/(online)/room" }, here);
  }
});

test("lobby and friends both mounted still answer one room with one push", () => {
  const first = navigationFor(NO_TABLE, room(), "other", "friends");
  assert.deepEqual(first, { kind: "push", to: "/(online)/room" });
  assert.equal(navigationFor(room(), room(), "other", "friends"), null);
  assert.equal(navigationFor(room(), room(), "room", "friends"), null);
});

test("an update to the room already followed moves nobody", () => {
  for (const here of ["lobby", "quickmatch", "room", "other"] as const) {
    assert.equal(navigationFor(room(), room(), here, "friends"), null, here);
  }
});

test("a seated game replaces the room it started from", () => {
  assert.deepEqual(navigationFor(room(), seated(), "room", "friends"), { kind: "replace", to: "/(online)/game" });
});

test("a game that arrives with its room, a cold rejoin, is pushed from the lobby", () => {
  assert.deepEqual(navigationFor(NO_TABLE, seated(), "lobby", null), { kind: "push", to: "/(online)/game" });
});

test("a watched game is pushed from the lobby", () => {
  assert.deepEqual(navigationFor(NO_TABLE, watching, "lobby", null), { kind: "push", to: "/(online)/game" });
});

test("a table that is gone leaves the room or the game for the lobby it came from", () => {
  for (const [prev, here] of [
    [room(), "room"],
    [seated(), "room"],
    [seated(), "game"],
    [watching, "game"],
  ] as const) {
    assert.deepEqual(navigationFor(prev, NO_TABLE, here, "friends"), { kind: "replace", to: "/(online)" }, here);
    assert.deepEqual(
      navigationFor(prev, NO_TABLE, here, "quickmatch"),
      { kind: "replace", to: "/(online)/quickmatch" },
      here
    );
  }
});

test("a refused rejoin leaves the table for the lobby, and moves nobody anywhere else", () => {
  assert.deepEqual(navigationFor(seated(), refused, "game", null), { kind: "replace", to: "/(online)" });
  assert.deepEqual(navigationFor(room(), refused, "room", "quickmatch"), {
    kind: "replace",
    to: "/(online)/quickmatch",
  });
  for (const here of ["lobby", "quickmatch", "other"] as const) {
    assert.equal(navigationFor(NO_TABLE, refused, here, null), null, here);
  }
});

test("the room screen holds only an unstarted room, however the player arrived", () => {
  assert.deepEqual(navigationFor(NO_TABLE, NO_TABLE, "room", "friends"), { kind: "replace", to: "/(online)" });
  assert.deepEqual(navigationFor(seated(), seated(), "room", "friends"), { kind: "replace", to: "/(online)/game" });
});

test("the game screen waits for a table it never held", () => {
  assert.equal(navigationFor(NO_TABLE, NO_TABLE, "game", null), null);
  assert.equal(navigationFor(NO_TABLE, room(), "game", null), null);
});

test("a spectator is never sent to a room, and a lobby the player backed into stays put", () => {
  assert.equal(navigationFor(watching, { ...watching, roomId: "r1" }, "game", null), null);
  assert.equal(navigationFor(NO_TABLE, { ...NO_TABLE, roomId: "r1", isSpectator: true }, "lobby", null), null);
  assert.equal(navigationFor(room(), seated(), "lobby", "friends"), null);
});

test("the lobby is quickmatch's for a quickmatch table and the hub's otherwise", () => {
  assert.equal(lobbyFor("quickmatch"), "/(online)/quickmatch");
  assert.equal(lobbyFor("friends"), "/(online)");
  assert.equal(lobbyFor(null), "/(online)");
});

test("segments name the online place the player is on", () => {
  assert.equal(onlineRouteOf(["(online)"]), "lobby");
  assert.equal(onlineRouteOf(["(online)", "index"]), "lobby");
  assert.equal(onlineRouteOf(["(online)", "quickmatch"]), "quickmatch");
  assert.equal(onlineRouteOf(["(online)", "room"]), "room");
  assert.equal(onlineRouteOf(["(online)", "game"]), "game");
  assert.equal(onlineRouteOf(["(online)", "friends"]), "other");
  assert.equal(onlineRouteOf([]), "other");
});
