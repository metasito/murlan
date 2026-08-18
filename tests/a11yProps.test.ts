// tests/a11yProps.test.ts — react-native-web 0.21 builds a node's DOM props by
// picking from an explicit allow-list (modules/forwardedProps/index.js). That
// list has no `accessibilityState`, no `accessibilityHint` and no
// `accessibilityElementsHidden`, so a control declaring its state through them
// reaches the shipped platform with none of it. lib/a11y.tsx emits the `aria-*`
// twin alongside; this pins that every call site goes through it.
//
// Structural, like tests/reducedMotion.test.ts: the property is about how the
// source is written, so it is checked by reading it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sourcesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(repoRoot, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...sourcesUnder(rel));
    else if (entry.name.endsWith(".tsx")) out.push(rel);
  }
  return out;
}

const DROPPED_PROPS =
  /\b(accessibilityState|accessibilityHint|accessibilityElementsHidden|importantForAccessibility)=/;

function offendingLines(source: string): string[] {
  return source
    .split("\n")
    .map((line, i) => [i + 1, line] as const)
    .filter(([, line]) => DROPPED_PROPS.test(line))
    .map(([n, line]) => `${n}: ${line.trim()}`);
}

test("no screen sets a prop react-native-web drops", () => {
  const offenders: string[] = [];
  for (const rel of [...sourcesUnder("app"), ...sourcesUnder("components")]) {
    for (const line of offendingLines(readFileSync(path.join(repoRoot, rel), "utf8"))) {
      offenders.push(`${rel}:${line}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `these reach the web build as nothing: ${offenders.join(" | ")}. ` +
      `Use a11yState / a11yHint / a11yHidden from lib/a11y instead.`
  );
});

test("the scanner matches a real use", () => {
  assert.deepEqual(
    offendingLines('        accessibilityState={{ selected: true }}\n        accessibilityLabel="x"\n'),
    ["1: accessibilityState={{ selected: true }}"]
  );
});

// The helper is only worth having if it emits the web half. A version that
// returned the React Native props alone would pass the scan above and change
// nothing on the platform Replit serves.
test("a11yState emits the aria twin for the role it is given", async () => {
  const source = readFileSync(path.join(repoRoot, "lib/a11y.tsx"), "utf8");
  for (const aria of ["aria-disabled", "aria-busy", "aria-expanded", "aria-checked", "aria-selected", "aria-hidden", "aria-describedby"]) {
    assert.ok(source.includes(`"${aria}"`), `lib/a11y.tsx never emits ${aria}`);
  }
});
