import { test } from "node:test";
import assert from "node:assert/strict";
import { destinationAfterAuth } from "../lib/authRedirect.ts";

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
