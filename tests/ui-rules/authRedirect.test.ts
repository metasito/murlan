import { test } from "node:test";
import assert from "node:assert/strict";
import { destinationAfterAuth, returnPathFor } from "../../lib/authRedirect.ts";

test("with no destination, signing in lands on home", () => {
  assert.equal(destinationAfterAuth(undefined), "/");
  assert.equal(destinationAfterAuth(""), "/");
});

test("an in-app absolute path is carried through", () => {
  assert.equal(destinationAfterAuth("/(online)/quickmatch"), "/(online)/quickmatch");
});

test("anything the router could read as somewhere else falls back to home", () => {
  for (const hostile of [
    "//evil.example.com",
    "https://evil.example.com",
    "javascript:alert(1)",
    "(online)/quickmatch",
    "/ok\nx",
  ]) {
    assert.equal(destinationAfterAuth(hostile), "/", hostile);
  }
});

test("an online screen sends sign-in back to itself, its params included", () => {
  assert.equal(returnPathFor(["(online)", "history"], {}), "/(online)/history");
  assert.equal(returnPathFor(["(online)", "index"], {}), "/(online)");
  assert.equal(returnPathFor(["(online)", "replay"], { id: "g 7/x" }), "/(online)/replay?id=g%207%2Fx");
  assert.equal(returnPathFor(["(online)", "friends"], { tab: ["a", "b"] }), "/(online)/friends?tab=a&tab=b");
});

test("a place the destination check refuses sends sign-in home, as before", () => {
  assert.equal(returnPathFor(["", "evil.example.com"], {}), "/");
});
