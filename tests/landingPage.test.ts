import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { __testables } from "../server/app.ts";

const { safeHost, renderLandingPage, CSP_DIRECTIVES } = __testables;

const template = fs.readFileSync(
  path.resolve(import.meta.dirname, "..", "server", "templates", "landing-page.html"),
  "utf-8"
);

test("a hostile Host header never reaches the page", () => {
  for (const hostile of [
    'x";alert(1);//',
    "x'></script><script>alert(1)</script>",
    "$&$`$'",
    "exps://evil.test",
    "a b",
    "",
  ]) {
    assert.notEqual(safeHost(hostile), hostile, `${hostile} was accepted`);
  }
});

test("a real Host header is passed through", () => {
  for (const good of ["murlan.replit.app", "localhost:5000", "127.0.0.1:19000"]) {
    assert.equal(safeHost(good), good);
  }
});

test("the rendered deep link closes its own string literal", () => {
  const html = renderLandingPage(template, safeHost('x";alert(1);//'), "Murlan");
  const deepLink = html.match(/const deepLink = "([^"]*)";/);
  assert.ok(deepLink, "the deepLink assignment is missing or its literal is broken open");
  assert.match(deepLink[1], /^exps:\/\/[A-Za-z0-9.:-]+$/);
  assert.equal(html.includes("alert(1)"), false);
});

test("`$&`-style sequences in a substituted value are not expanded", () => {
  const html = renderLandingPage(template, "host.test", "$&$`$'");
  assert.ok(html.includes("<title>$&$`$'</title>"));
});

test("the only third-party script the page loads carries an integrity hash", () => {
  const external = [...template.matchAll(/<script\b[^>]*\bsrc=["'](https?:[^"']+)["'][^>]*>/g)];
  assert.equal(external.length, 1);
  const tag = external[0][0];
  assert.match(tag, /integrity="sha(256|384|512)-[A-Za-z0-9+/=]+"/);
  assert.match(tag, /crossorigin=/);
  assert.ok(
    CSP_DIRECTIVES["script-src"].includes(new URL(external[0][1]).origin),
    "the script's origin is not in script-src"
  );
});

test("the CSP names an origin for every fetch the app makes", () => {
  assert.deepEqual(CSP_DIRECTIVES["default-src"], ["'self'"]);
  assert.deepEqual(CSP_DIRECTIVES["object-src"], ["'none'"]);
  assert.deepEqual(CSP_DIRECTIVES["frame-ancestors"], ["'none'"]);
  // Relative subresource URLs on the http dev server would be rewritten to https.
  assert.equal("upgrade-insecure-requests" in CSP_DIRECTIVES, false);
});
