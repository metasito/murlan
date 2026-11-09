import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { isBenchHost } from "../../lib/diagnostics/benchLaunch.ts";

const root = path.resolve(import.meta.dirname, "../..");

function files(dir: string): string[] {
  return readdirSync(path.join(root, dir), { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && /\.ya?ml$/.test(e.name))
    .map((e) => path.join(e.parentPath, e.name));
}

/** Every host a `murlan://bench` link in a Maestro flow or workflow passes. */
export function benchLinkHosts(text: string): string[] {
  return [...text.matchAll(/murlan:\/\/bench\?(?:[^"'\s]*&)?host=([^&"'\s]*)/g)].map((m) => m[1]);
}

test("every bench deep link passes a host the bench accepts", () => {
  const refused: string[] = [];
  let seen = 0;
  for (const file of [...files(".maestro"), ...files(".github")]) {
    for (const host of benchLinkHosts(readFileSync(file, "utf8"))) {
      seen++;
      if (!isBenchHost(host)) refused.push(`${path.relative(root, file)}: host=${host}`);
    }
  }
  assert.ok(seen >= 3, `only ${seen} bench links found: the scan lost its way`);
  assert.deepEqual(refused, []);
});

test("the scan sees a planted localhost", () => {
  assert.deepEqual(benchLinkHosts('- openLink: "murlan://bench?host=localhost&scenario=x"'), ["localhost"]);
  assert.equal(isBenchHost("localhost"), false);
});
