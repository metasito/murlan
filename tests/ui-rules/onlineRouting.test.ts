import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { blankComments, blankCommentsAndStrings, scanSources, sourcesUnder } from "../helpers/sourceScan.ts";
import {
  NO_TABLE,
  guardsRoomBack,
  leaveNavigation,
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

test("a leave owes its own way out only when it gives up nothing the router follows", () => {
  assert.deepEqual(leaveNavigation(NO_TABLE, "quickmatch"), { kind: "replace", to: "/(online)/quickmatch" });
  assert.deepEqual(leaveNavigation(NO_TABLE, null), { kind: "replace", to: "/(online)" });
  for (const held of [room(), seated(), watching]) {
    assert.equal(leaveNavigation(held, "friends"), null);
    assert.deepEqual(navigationFor(held, NO_TABLE, "game", "friends"), { kind: "replace", to: "/(online)" });
  }
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

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ROUTER = "context/useOnlineRouting.ts";
const TABLE = "context/onlineRouting.ts";
const SCREENS = ["index", "quickmatch", "friends", "room", "game"].map((s) => `app/(online)/${s}.tsx`);
const TO_TABLE = /["'`](?:\/\(online\)\/(?:room|game)|\/room)["'`]/g;
const ROUTES = /\brouter\./;

/** The argument text of every effect call, balanced by parentheses. */
function effectBodies(source: string): string[] {
  const code = blankCommentsAndStrings(source);
  const bodies: string[] = [];
  for (const m of code.matchAll(/\b(?:useEffect|useLayoutEffect|useFocusEffect)\(/g)) {
    const open = m.index + m[0].length;
    let depth = 1;
    let i = open;
    while (i < code.length && depth > 0) {
      if (code[i] === "(") depth++;
      else if (code[i] === ")") depth--;
      i++;
    }
    bodies.push(code.slice(open, i - 1));
  }
  return bodies;
}

test("no source but the routing table names the room or the game", () => {
  const sources = sourcesUnder(repoRoot, ["app", "components", "lib", "context"]);
  for (const file of [...SCREENS, ROUTER]) assert.ok(sources.some(([f]) => f === file), `${file} is scanned`);
  const code = sources.map(([f, src]): [string, string] => [f, blankComments(src)]);
  const owned = scanSources(TO_TABLE, code.filter(([f]) => f === TABLE)).join("\n");
  for (const place of ["/(online)/room", "/(online)/game"]) assert.ok(owned.includes(place), `${TABLE} spells ${place}`);
  assert.deepEqual(scanSources(TO_TABLE, code.filter(([f]) => f !== TABLE)), []);
  const plants = [
    'router.push("/(online)/room");',
    'router.navigate("/(online)/game");',
    'router.replace({ pathname: "/(online)/room" });',
    '<Redirect href="/(online)/game" />',
    "<Link href='/room'>",
    "const ROOM = `/(online)/room`;",
  ];
  for (const plant of plants) assert.equal(scanSources(TO_TABLE, [["planted.tsx", plant]]).length, 1, plant);
  assert.deepEqual(scanSources(TO_TABLE, [["offline.tsx", 'router.push("/game");']]), []);
});

test("where a table was entered from is spelled once", () => {
  const SPELLED = /["']quickmatch["']\s*\|\s*["']friends["']|["']friends["']\s*\|\s*["']quickmatch["']/g;
  const sources = sourcesUnder(repoRoot, ["app", "components", "lib", "context"]);
  assert.deepEqual(scanSources(SPELLED, sources), [`context/onlineRouting.ts: "quickmatch" | "friends"`]);
  assert.equal(scanSources(SPELLED, [["planted.ts", `let s: "friends" | "quickmatch";`]]).length, 1);
});

test("no online screen routes from an effect", () => {
  const effects = sourcesUnder(repoRoot, ["app/(online)"]).flatMap(([file, src]) =>
    effectBodies(src).map((body) => [file, body] as const)
  );
  assert.ok(effects.length > 0, "the online screens' effects are read");
  assert.deepEqual(effects.filter(([, body]) => ROUTES.test(body)).map(([file]) => file), []);
  const planted = 'useEffect(() => {\n  if (roomId) router.push("/(online)/room");\n}, [roomId]);';
  assert.ok(effectBodies(planted).some((body) => ROUTES.test(body)), "a planted effect is caught");
  const behindAParen = 'useEffect(() => {\n  log("closed)");\n  router.push("/(online)/room");\n}, []);';
  assert.ok(effectBodies(behindAParen).some((body) => ROUTES.test(body)), "a ')' in a string ends no effect");
});

test("back on the room asks only while the room screen is the player's to leave", () => {
  assert.equal(guardsRoomBack(room()), true);
  for (const facts of [NO_TABLE, seated(), watching, refused, { ...room(), rejoinFailed: true }]) {
    assert.equal(guardsRoomBack(facts), false, JSON.stringify(facts));
  }
});

test("no navigation away from the room is ever met by the back guard", () => {
  const all: OnlineFacts[] = [];
  for (const roomId of [null, "r1", "r2"])
    for (const hasGame of [false, true])
      for (const isSpectator of [false, true])
        for (const rejoinFailed of [false, true]) all.push({ roomId, hasGame, isSpectator, rejoinFailed });
  let moves = 0;
  for (const prev of all)
    for (const next of all)
      for (const entrySource of ["quickmatch", "friends", null] as const) {
        if (!navigationFor(prev, next, "room", entrySource)) continue;
        moves++;
        assert.equal(guardsRoomBack(next), false, `${JSON.stringify(prev)} -> ${JSON.stringify(next)}`);
      }
  assert.ok(moves > 0, "the room's own navigations are enumerated");
});

test("no redirect to sign-in forgets where the player was going", () => {
  const TO_AUTH = /<Redirect\b(?:(?!\/>)[\s\S])*?["'`]\/auth["'`](?:(?!\/>)[\s\S])*?\/>/g;
  const bare = (hits: string[]) => hits.filter((hit) => !/\bnext\b/.test(hit));
  const sources = sourcesUnder(repoRoot, ["app"]).map(([f, src]): [string, string] => [f, blankComments(src)]);
  assert.ok(scanSources(TO_AUTH, sources).length >= 2, "the sign-in redirects are read");
  assert.deepEqual(bare(scanSources(TO_AUTH, sources)), []);
  for (const plant of ['<Redirect href="/auth" />', "<Redirect\n  href={{ pathname: '/auth' }}\n/>"]) {
    assert.equal(bare(scanSources(TO_AUTH, [["planted.tsx", plant]])).length, 1, plant);
  }
});
