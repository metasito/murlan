import { test } from "node:test";
import assert from "node:assert/strict";
import { joinRouteFor, systemPath } from "../../lib/deepLink.ts";

test("a join link opens that room's join flow, in any of the forms the system hands over", () => {
  assert.equal(systemPath("murlan://join/AB12"), "/join/AB12");
  assert.equal(systemPath("/join/AB12"), "/join/AB12");
  assert.equal(systemPath("join/ab12"), "/join/AB12");
  assert.equal(systemPath("https://murlan.app/join/QX7K2M"), "/join/QX7K2M");
  assert.equal(systemPath("murlan://join/qx7k2m/?ref=share"), "/join/QX7K2M");
});

test("any other path, and a malformed code, lands on home", () => {
  for (const path of [
    "/",
    "murlan://",
    "rules",
    "/(online)/room",
    "join",
    "join/",
    "join/AB1",
    "join/AB12CDE",
    "join/AB-12",
    "join/AB12/extra",
    "murlan://join/../auth",
    "notjoin/AB12",
  ]) {
    assert.equal(systemPath(path), "/", path);
  }
});

test("a pushed room code reaches the same route, and only a well-formed one", () => {
  assert.equal(joinRouteFor("qx7k2m"), "/join/QX7K2M");
  for (const code of [undefined, null, 42, "", "AB/12", "../auth", "AB12CDE"]) {
    assert.equal(joinRouteFor(code), null, String(code));
  }
});
