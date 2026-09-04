// tests/loopDocsAreExecutable.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

/**
 * The loop's instructions name commands and files. Prose cannot be run, so every one of those
 * names is a claim nobody checks — and this branch found four that were false: a `gh` call
 * duplicating the picker, a peer lock that was a memory wait, a hook whose shell could not parse
 * it, and a protected-path rule the command file contradicted.
 *
 * Each was found by reading. Reading does not scale and does not repeat, so the same sweep is
 * here instead: it fails when the docs name something that is not there.
 */
const QUEUE = ".claude/commands/queue.md";
const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");

describe("the loop's instructions name only things that exist", () => {
  test(`${QUEUE} is present`, () => {
    assert.ok(read(QUEUE).length > 0, `${QUEUE} is missing`);
  });

  test("every `node scripts/x.mjs` it tells you to run is a real script", () => {
    const named = [...read(QUEUE).matchAll(/node\s+(scripts\/[\w.-]+\.mjs)/g)].map((m) => m[1]);
    assert.ok(named.length >= 3, "no script invocations found; the pattern has drifted");
    const missing = [...new Set(named)].filter((s) => !existsSync(s));
    assert.deepEqual(missing, [], `queue.md tells the agent to run scripts that do not exist`);
  });

  test("every `npx tsx lib/...` it tells you to run is a real module", () => {
    const named = [...read(QUEUE).matchAll(/npx\s+tsx\s+(lib\/[\w./-]+\.ts)/g)].map((m) => m[1]);
    assert.ok(named.length >= 1, "no tsx invocations found; the pattern has drifted");
    const missing = [...new Set(named)].filter((s) => !existsSync(s));
    assert.deepEqual(missing, [], `queue.md tells the agent to run modules that do not exist`);
  });

  test("every `npm run x` it tells you to run is a real script", () => {
    const pkg = JSON.parse(read("package.json")).scripts ?? {};
    const named = [...read(QUEUE).matchAll(/npm\s+run\s+([\w:-]+)/g)].map((m) => m[1]);
    assert.ok(named.length >= 2, "no npm invocations found; the pattern has drifted");
    const missing = [...new Set(named)].filter((s) => !(s in pkg));
    assert.deepEqual(missing, [], `queue.md names npm scripts that package.json does not define`);
  });

  // Loop artefacts live outside the working tree now, so there is no file to assert the existence
  // of — what must hold is that the docs no longer point at the tracked copies that used to be
  // rewritten into a dirty tree, and that the template they are laid down from is still shipped.
  test("the docs do not point at a tracked, rewritable state file", () => {
    const q = read(QUEUE);
    for (const gone of [".claude/loop/STATE.md", ".claude/loop/LESSONS.md", ".claude/loop/PARKED.md", ".claude/loop/DONE.md"]) {
      assert.ok(!q.includes(gone), `queue.md still points at ${gone}, which no longer exists`);
    }
    assert.ok(existsSync(".claude/loop/STATE.template.md"), "the state template must be shipped");
  });

  // A hook is the one instruction nobody reads and nothing imports, so a broken one fails silently
  // and forever. This branch shipped with all three broken that way.
  test("no hook depends on a shell expansion or on shell syntax", () => {
    const settings = JSON.parse(read(".claude/settings.json"));
    const commands: string[] = Object.values(settings.hooks ?? {})
      .flat()
      .flatMap((g: any) => (g.hooks ?? []).map((h: any) => h.command));
    assert.ok(commands.length > 0, "no hooks configured; this guard is watching nothing");

    for (const c of commands) {
      assert.doesNotMatch(c, /\$\w|\$\{/, `hook relies on shell variable expansion: ${c}`);
      assert.doesNotMatch(c, /&&|\|\||\[\s+-\w\s/, `hook relies on POSIX shell syntax: ${c}`);
      const script = /node\s+([\w./-]+)/.exec(c)?.[1];
      if (script) assert.ok(existsSync(script), `hook runs a script that does not exist: ${script}`);
    }
  });
});
