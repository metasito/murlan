// tests/loopDocsAreExecutable.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { allowedTools } from "../scripts/loop-tools.mjs";
import { PHASE_MARKERS, toPattern } from "../scripts/loop-stream.mjs";
import { queueLoopArgs } from "../scripts/queue-loop.mjs";

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

  // The CI verdict and the merge moved to the supervisor, so it is queue-loop.mjs that names these
  // now. Scanning both keeps the check pointed at whoever actually invokes them.
  test("every `lib/loop/*.ts` the loop invokes is a real module", () => {
    const sources = `${read(QUEUE)} ${read("scripts/queue-loop.mjs")}`;
    const named = [...sources.matchAll(/(lib\/loop\/[\w.-]+\.ts)/g)].map((m) => m[1]);
    assert.ok(named.length >= 1, "no lib/loop invocations found; the pattern has drifted");
    const missing = [...new Set(named)].filter((s) => !existsSync(s));
    assert.deepEqual(missing, [], `the loop invokes modules that do not exist`);
  });

  test("every `npm run x` it tells you to run is a real script", () => {
    const pkg = JSON.parse(read("package.json")).scripts ?? {};
    const named = [...read(QUEUE).matchAll(/npm\s+run\s+([\w:-]+)/g)].map((m) => m[1]);
    assert.ok(named.length >= 2, "no npm invocations found; the pattern has drifted");
    const missing = [...new Set(named)].filter((s) => !(s in pkg));
    assert.deepEqual(missing, [], `queue.md names npm scripts that package.json does not define`);
  });

  // The loop stores nothing now, so what must hold is that neither instruction file points at the
  // state layer that was deleted — including CLAUDE.md, which the previous version of this test
  // did not check, and which kept a dead path through a whole rebuild.
  test("no instruction file points at the deleted state layer", () => {
    for (const file of [QUEUE, "CLAUDE.md"]) {
      const text = read(file);
      for (const gone of [
        ".claude/loop/",
        "loop-state.mjs",
        "loop-brief.mjs",
        "STATE.md",
        "LESSONS.md",
      ]) {
        assert.ok(!text.includes(gone), `${file} still points at ${gone}, which no longer exists`);
      }
    }
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

describe("phase A's housekeeping belongs to the supervisor", () => {
  test("queue.md names the one command a by-hand run needs", () => {
    assert.match(read(QUEUE), /npm run queue:pre/, "a by-hand /queue still needs the pre-checks");
  });

  test("it does not also ask the model to run what the supervisor already ran", () => {
    const text = read(QUEUE);
    for (const moved of ["node scripts/prune-worktrees.mjs", "node scripts/preflight.mjs"]) {
      assert.ok(!text.includes(moved), `${moved} moved to the supervisor; queue.md must not ask for it too`);
    }
  });

  test("loop-status.mjs stays, because it is what tells a fresh session a run is live", () => {
    assert.match(read(QUEUE), /node scripts\/loop-status\.mjs/);
  });
});

// The marker table is a premise about queue.md's commands, and a premise in prose decays: this PR
// moved the worktree teardown to the supervisor, and phase F's marker went on naming a command the
// file no longer contains — a board that would have printed five phases out of six, silently.
describe("every phase marker names a command queue.md actually runs", () => {
  test("each doc string matches a line of the file", () => {
    const text = read(QUEUE);
    for (const marker of PHASE_MARKERS) {
      if (!marker.doc) continue;
      assert.match(text, toPattern(marker.doc), `phase ${marker.phase}: queue.md no longer runs "${marker.doc}"`);
    }
  });

  test("the table covers every phase the session itself can mark", () => {
    const marked = PHASE_MARKERS.map((m) => m.phase);
    assert.deepEqual(marked, ["A", "B", "E"], "C and D come from derive(); F is the supervisor's own work");
  });
});

describe("the --tools list is queue.md's own declaration", () => {
  test("parsed from the frontmatter rather than copied into the supervisor", () => {
    const tools = allowedTools(read(QUEUE));
    assert.ok(tools.length >= 5, "allowed-tools frontmatter did not parse; the shape has drifted");
    assert.ok(tools.includes("Bash"));
    assert.ok(tools.includes("Task"), "phase B dispatches a subagent");
    assert.ok(tools.includes("Skill"), "phase C names two skills by name");
  });

  test("a file with no such frontmatter yields nothing, rather than a wrong list", () => {
    assert.deepEqual(allowedTools("# just a heading\n"), []);
  });

  test("the list it yields is what the spawn actually passes", () => {
    const args = queueLoopArgs();
    const passed = args[args.indexOf("--tools") + 1].split(",");
    assert.deepEqual(passed, allowedTools(read(QUEUE)));
  });
});
