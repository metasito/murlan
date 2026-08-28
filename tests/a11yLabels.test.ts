// tests/a11yLabels.test.ts — a label on a plain container reaches nobody.
//
// React Native only makes a view an accessibility element when `accessible` is
// true; react-native-web renders a role-less View as a bare <div>, whose
// implicit ARIA role is `generic`, for which a name is prohibited. So an
// `accessibilityLabel` on a layout container is in the DOM and in no
// accessibility tree.
//
// A container that cannot take `accessible` without collapsing its own
// controls into one unreachable leaf must hand the sentence to an
// `<A11yStatus>` instead. That is the escape this pins.
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

/** Containers with no accessibility semantics of their own. */
const CONTAINERS = /^(Animated\.)?(View|ScrollView)$/;
const OPENS_TAG = /^\s*<([A-Za-z][\w.]*)\b/;
// Both spellings, so a grouped container is a candidate here rather than
// invisible to the scan: without the second the `a11yGroup` branch below could
// only fire on a tag carrying both, which is a tag nobody writes.
const LABEL = /accessibilityLabel=(\{[^}]*\}|"[^"]*")|(\{\.\.\.a11yGroup\()/;
// `accessible` is deliberately absent: it makes a view an accessibility element
// on iOS and reaches the DOM as nothing, so on web it leaves the label on a
// role-less <div>. A role is what lets a name be announced, and `a11yGroup` is
// where a container gets one.
const REACHABLE = /a11yGroup\(|accessibilityRole|a11yState\(/;

/** `file:line: <Tag> label` for every container whose label reaches nobody. */
export function unreachableLabels(source: string): string[] {
  const lines = source.split("\n");
  const statuses = new Set(
    [...source.matchAll(/<A11yStatus\s+label=(\{[^}]*\})/g)].map((m) => m[1])
  );
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const tag = OPENS_TAG.exec(lines[i]);
    if (!tag || !CONTAINERS.test(tag[1])) continue;

    // Props run to the line that closes the opening tag. This codebase writes
    // one prop per line, and `=>` is the only other way a line ends in `>`.
    let props = lines[i];
    let end = i;
    while (end < lines.length - 1 && !/(^|[^=])>\s*$|\/>\s*$/.test(lines[end])) {
      end += 1;
      props += `\n${lines[end]}`;
    }

    const label = LABEL.exec(props);
    if (!label || REACHABLE.test(props) || statuses.has(label[1])) continue;
    out.push(`${i + 1}: <${tag[1]}> ${label[0]}`);
  }
  return out;
}

test("no container label reaches nobody", () => {
  const offenders: string[] = [];
  for (const rel of [...sourcesUnder("app"), ...sourcesUnder("components")]) {
    for (const hit of unreachableLabels(readFileSync(path.join(repoRoot, rel), "utf8"))) {
      offenders.push(`${rel}:${hit}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `these labels are announced by nothing: ${offenders.join(" | ")}. ` +
      `Add accessibilityRole, or render an <A11yStatus label={…}/> carrying the same sentence.`
  );
});

test("the scanner matches a real use", () => {
  assert.deepEqual(
    unreachableLabels('      <View\n        accessibilityLabel={tableLabel}\n        style={styles.x}\n      >\n'),
    ["1: <View> accessibilityLabel={tableLabel}"]
  );
  assert.deepEqual(
    unreachableLabels(
      '      <A11yStatus label={tableLabel} />\n      <View\n        accessibilityLabel={tableLabel}\n      >\n'
    ),
    []
  );
  // `accessible` is an iOS-only half. It makes the container a leaf there and
  // reaches the DOM as nothing, so the label is still announced by nobody on
  // web — which is the whole reason `a11yGroup` carries a role as well.
  assert.deepEqual(
    unreachableLabels('      <View accessible accessibilityLabel={x}>\n'),
    ["1: <View> accessibilityLabel={x}"]
  );
  assert.deepEqual(unreachableLabels('      <View {...a11yGroup(x)}>\n'), []);
});
