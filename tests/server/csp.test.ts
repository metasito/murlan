import { test } from "node:test";
import assert from "node:assert/strict";
import { __testables } from "../../server/app.ts";

const CSP_DIRECTIVES = __testables.cspDirectives();

test("the CSP names an origin for every fetch the app makes", () => {
  assert.deepEqual(CSP_DIRECTIVES["default-src"], ["'self'"]);
  assert.deepEqual(CSP_DIRECTIVES["object-src"], ["'none'"]);
  assert.deepEqual(CSP_DIRECTIVES["frame-ancestors"], ["'none'"]);
  // Relative subresource URLs on the http dev server would be rewritten to https.
  assert.equal("upgrade-insecure-requests" in CSP_DIRECTIVES, false);
});

test("no inline script runs on the strength of being inline", () => {
  assert.equal(CSP_DIRECTIVES["script-src"].includes("'unsafe-inline'"), false);
});

test("connect-src names hosts rather than every websocket on the internet", () => {
  assert.equal(CSP_DIRECTIVES["connect-src"].includes("ws:"), false);
  assert.equal(CSP_DIRECTIVES["connect-src"].includes("wss:"), false);
});
