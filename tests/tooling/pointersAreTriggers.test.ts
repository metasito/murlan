// tests/tooling/pointersAreTriggers.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

// The three always-loaded instruction files. Each names other documents; each pointer must say
// the condition for going there, not just describe the target — a pointer that only describes
// its target is not reached.
const FILES: Record<string, number> = { "CLAUDE.md": 4, "components/CLAUDE.md": 1, "server/CLAUDE.md": 1 };

// A pointer targets a markdown doc: any backtick span ending `.md`, not only one rooted at
// docs/ or .claude/ — CLAUDE.md's own list points at components/CLAUDE.md and server/CLAUDE.md.
const MD_TARGET = /`[^`]*\.md`/;
// Anchored to the lead clause, not the whole sentence: a trigger word must appear before the
// pointer's target, or a topic sentence with "when you need it" tacked on the end would pass.
const TRIGGER = /\b(before|when|after|once|if)\b/i;

// A list item can wrap onto indented continuation lines; join them so the target and its lead
// clause are read as one sentence, not split at an arbitrary line break.
function pointerItems(body: string): string[] {
  const items: string[] = [];
  let current: string | null = null;
  for (const line of body.split("\n")) {
    if (/^- /.test(line)) {
      if (current !== null) items.push(current);
      current = line;
    } else if (current !== null && /^\s{2,}\S/.test(line)) {
      current += " " + line.trim();
    } else {
      if (current !== null) items.push(current);
      current = null;
    }
  }
  if (current !== null) items.push(current);
  return items.filter((item) => MD_TARGET.test(item));
}

function leadClause(item: string): string {
  const match = item.match(MD_TARGET);
  return match ? item.slice(0, match.index) : item;
}

for (const [file, minimum] of Object.entries(FILES)) {
  test(`every pointer in ${file} names its trigger before the link`, () => {
    const items = pointerItems(read(file));
    assert.ok(items.length >= minimum, `found ${items.length} pointer(s) in ${file}; the list moved`);
    const untriggered = items.filter((item) => !TRIGGER.test(leadClause(item)));
    assert.deepEqual(untriggered, [], `${file} has a pointer with no lead trigger:\n${untriggered.join("\n")}`);
  });
}

// The classifier itself, pinned against synthetic lines so a future loosening of MD_TARGET or
// TRIGGER shows up here first, not as a silently accepted pointer in one of the three files.
test("the trigger check rejects a topic-only pointer and a trailing trigger word", () => {
  const topicOnly = "- see `docs/agents/checks.md` for check info.";
  const trailingTrigger = "- `docs/agents/checks.md` — which check catches what, when you need it.";
  for (const bad of [topicOnly, trailingTrigger]) {
    const items = pointerItems(bad);
    assert.equal(items.length, 1, `fixture should read as one pointer item: ${bad}`);
    assert.equal(TRIGGER.test(leadClause(items[0])), false, `should be rejected: ${bad}`);
  }
});
