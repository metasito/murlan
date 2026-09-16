// tools/loop/tests/loopDocsAreExecutable.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { allowedTools } from "../loop-tools.mjs";
import { readLine } from "../loop-stream.mjs";
import { queueLoopArgs } from "../queue-loop.mjs";
import { ciLogPath } from "../loop-logs.mjs";

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

  test("every `node tools/loop/x.mjs` it tells you to run is a real script", () => {
    const named = [...read(QUEUE).matchAll(/node\s+(tools\/loop\/[\w.-]+\.mjs)/g)].map((m) => m[1]);
    assert.ok(named.length >= 3, "no script invocations found; the pattern has drifted");
    const missing = [...new Set(named)].filter((s) => !existsSync(s));
    assert.deepEqual(missing, [], `queue.md tells the agent to run scripts that do not exist`);
  });

  // `ciVerdict.ts` and `land.ts` used to be named here as `npx tsx` argument strings, which a scan
  // like the one above was the only way to check. They are static imports of queue-loop.mjs now, so
  // a missing one is a load error before any test in this file runs — which is why there is no scan
  // for them.

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
    const hooks: { command: string; args?: string[] }[] = Object.values(settings.hooks ?? {})
      .flat()
      .flatMap((g: any) => g.hooks ?? []);
    assert.ok(hooks.length > 0, "no hooks configured; this guard is watching nothing");

    for (const { command, args } of hooks) {
      assert.doesNotMatch(command, /\$|&&|\|\||\s/, `hook command is shell form: ${command}`);
      assert.ok(args, `hook without args runs through a shell: ${command}`);
      for (const arg of args) {
        const script = arg.replace(/^\$\{CLAUDE_PROJECT_DIR\}\//, "");
        assert.doesNotMatch(script, /\$/, `hook arg uses a placeholder Claude Code does not substitute: ${arg}`);
        assert.ok(existsSync(script), `hook runs a script that does not exist: ${arg}`);
      }
    }
  });
});

describe("phase A's housekeeping belongs to the supervisor", () => {
  test("queue.md names the one command a by-hand run needs", () => {
    assert.match(read(QUEUE), /npm run queue:pre/, "a by-hand /queue still needs the pre-checks");
  });

  test("it does not also ask the model to run what the supervisor already ran", () => {
    const text = read(QUEUE);
    for (const moved of ["node tools/loop/prune-worktrees.mjs", "node tools/loop/preflight.mjs"]) {
      assert.ok(!text.includes(moved), `${moved} moved to the supervisor; queue.md must not ask for it too`);
    }
  });

  test("loop-status.mjs stays, because it is what tells a fresh session a run is live", () => {
    assert.match(read(QUEUE), /node tools\/loop\/loop-status\.mjs/);
  });
});

// The supervisor reads the session's own `PHASE <letter>` line and nothing else about its
// progress. Inferring it from outside by regexing queue.md's commands missed 74 of 131 markers,
// because queue.md itself prescribes `git add -- <paths>` before committing.
describe("every phase of queue.md reports itself", () => {
  // Taken from the document verbatim and read by the parser that will read it off the session. The
  // test used to assert a second spelling of its own, so queue.md could be decorated in a way the
  // reader rejects outright and both sides would still pass.
  const marker = (letter: string) =>
    read(QUEUE)
      .split("\n")
      .find((line) => new RegExp("^\\W*PHASE " + letter + "\\W*$").test(line));

  for (const letter of ["A", "B", "C", "D", "E", "F"]) {
    test(`phase ${letter}'s marker is one the supervisor reads`, () => {
      const line = marker(letter);
      assert.ok(line, `phase ${letter} has no echo`);
      const fact = readLine(
        JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: line }] } }),
      ) as any;
      assert.equal(fact?.letter, letter, `the supervisor cannot read ${JSON.stringify(line)}`);
    });
  }

  test("the echo is a line of its own, which is what the reader matches", () => {
    // A sentence mentioning the phase is not a phase report, so the instruction has to say so.
    assert.match(read(QUEUE), /on a line of its own/);
  });

  // In print mode a turn that ends in text and no tool call is the final answer, so a marker the
  // model is told to send by itself can end the session on turn one — #942's first run died on
  // `PHASE A`, seven seconds and one turn in. The previous version of this test asserted that
  // exact wording, pinning the hazard as the requirement.
  test("it never asks for the marker as a message of its own", () => {
    const text = read(QUEUE);
    assert.doesNotMatch(text, /as the whole of one message/);
    assert.match(text, /in the same message as that phase's first command/);
  });
});

// Nine of the ten channels the supervisor reads a finished session through are inferences about a
// process that has already exited, and phase F's teardown destroys five of them at once.
describe("the session declares what it did before it exits", () => {
  test("phase F asks for the LOOP-RESULT line, in the parser's own shape", () => {
    const text = read(QUEUE);
    assert.match(text, /^\s*LOOP-RESULT \{.*"ticket".*\}$/m, "queue.md must show the literal shape");
    assert.match(text, /"stoodDown"/, "a stand-down is the case the supervisor cannot otherwise see");
  });

  // The example in the instructions is also a test fixture: a model copies its shape, so a shape
  // the parser rejects is an instruction to emit something unreadable.
  test("every example it prints is one the parser reads", () => {
    const examples = [...read(QUEUE).matchAll(/^\s*(LOOP-RESULT \{.*\})\s*$/gm)].map((m) => m[1]);
    assert.ok(examples.length, "no LOOP-RESULT example in queue.md");
    for (const example of examples) {
      // `<n>` is the doc's placeholder for a ticket number, which is the one thing the parser needs.
      const text = example.replace(/<n>/g, "7");
      const fact = readLine(
        JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text }] } }),
      ) as any;
      assert.ok(fact?.declared?.ticket, `queue.md's own example does not parse: ${example}`);
    }
  });

  test("the teardown it names still runs before the declaration, so the facts are final", () => {
    const text = read(QUEUE);
    const from = text.indexOf("## F — Close out");
    assert.notEqual(from, -1, "phase F's heading has moved");
    const f = text.slice(from);
    // Each position is asserted present before they are compared: `indexOf` answers -1 for a line
    // that is gone, and -1 sorts before everything, so the comparison alone passes on an absent
    // teardown.
    const teardown = f.indexOf("worktrees:remove -- .worktrees/agent-<n>");
    const declaration = f.indexOf("LOOP-RESULT");
    assert.notEqual(teardown, -1, "phase F no longer names the teardown");
    assert.notEqual(declaration, -1, "phase F no longer asks for the declaration");
    assert.ok(teardown < declaration, "the declaration is the last thing the session emits");
  });

  /**
   * The general form of the defect, and the only one a reader would not catch: two sections of one
   * document both instructing the session what its final line is. Both were obeyable, the session
   * obeyed the later one, and `LOOP-RESULT` — the supervisor's only channel that is a statement
   * rather than an inference — reached it in two runs of nineteen.
   *
   * A protocol document needs a test that the protocol it describes is self-consistent, the same
   * way `rulesAreSingleSourced.test.ts` pins the rules list.
   */
  test("every instruction to emit a line is bound to the one line the supervisor reads", () => {
    const text = read(QUEUE);
    // Instructions to *emit*, not prose that happens to use the words: "the last thing you emit",
    // "Between tickets, exactly one line". Prose about a shell command's last line is neither.
    const instructions = [...text.matchAll(/^.*\b(?:you emit|exactly one line)\b.*$/gim)];
    assert.ok(instructions.length > 0, "nothing in queue.md says what the session emits any more");
    // Within the instruction's own paragraph, because the template follows the sentence rather
    // than sitting on it.
    const WINDOW = 400;
    const orphans = instructions
      .filter((m) => !text.slice(m.index, m.index + WINDOW).includes("LOOP-RESULT"))
      .map((m) => m[0].trim());
    assert.deepEqual(
      orphans,
      [],
      "a second instruction claims the session's output; the supervisor only reads LOOP-RESULT",
    );
  });

  test("the Output section points at the declaration rather than asking for a summary of its own", () => {
    const text = read(QUEUE);
    const from = text.indexOf("## Output");
    assert.notEqual(from, -1, "the Output section has moved");
    const out = text.slice(from);
    assert.match(out, /LOOP-RESULT/, "Output must defer to the declaration");
    assert.doesNotMatch(
      out,
      /^\s*`?[✅✓]\s*#</m,
      "the between-tickets summary line is what LOOP-RESULT lost the final line to",
    );
  });
});

// The supervisor hands a red CI round back to a fresh session on the same ticket. That session has
// no worktree — phase F removed it — so the protocol has to say how it gets one back.
describe("a CI fix round is a documented path, not an improvisation", () => {
  test("phase A names how to rebuild the worktree from the pushed branch", () => {
    // Flags before the path: `git worktree add <path> -B <branch>` parses, and then does not mean
    // what phase A's own `-b` form means two sections above it.
    assert.match(read(QUEUE), /git worktree add -B agent\/<n>-<slug> \.worktrees\/agent-<n>/);
  });

  // Resolved through the function that writes it, not scanned for as text: a path spelled the
  // same in two files is a premise that decays, and a scan cannot tell a mention from a caller.
  test("the log path it names is the one the supervisor writes", () => {
    const named = /\.loop-logs\/ci-<n>\.log/.exec(read(QUEUE))?.[0];
    assert.ok(named, "queue.md never tells the fix session where its CI log is");
    assert.equal(ciLogPath(953).replace(/\\/g, "/"), named.replace("<n>", "953"));
  });
});

// The session is the only process that knows whether its tree is dirty. The supervisor removed it
// without --force against a post-push tree that is always dirty, the removal refused, and the
// surviving directory made derive() report a live run.
describe("the session tears down its own worktree", () => {
  test("phase F names the script that detaches the junction first", () => {
    assert.match(read(QUEUE), /npm run worktrees:remove -- \.worktrees\/agent-<n>/);
  });

  test("nothing still claims the supervisor does it", () => {
    assert.doesNotMatch(read(QUEUE), /The loop tears the worktree down/);
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
    const args = queueLoopArgs(1);
    const passed = args[args.indexOf("--tools") + 1].split(",");
    assert.deepEqual(passed, allowedTools(read(QUEUE)));
  });
});
