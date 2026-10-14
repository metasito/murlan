// tools/loop/tests/loopDocsAreExecutable.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { allowedTools } from "../loop-tools.mjs";
import { readLine } from "../loop-stream.mjs";
import { ciRedBody, queueLoopArgs, CHECK_BASH_TIMEOUT_MS, BASH_DEFAULT_TIMEOUT_MS } from "../queue-loop.mjs";
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
      const [first, ...flags] = args;
      const script = first.replace(/^\$\{CLAUDE_PROJECT_DIR\}\//, "");
      for (const arg of [script, ...flags]) {
        assert.doesNotMatch(arg, /\$/, `hook arg uses a placeholder Claude Code does not substitute: ${arg}`);
      }
      assert.ok(existsSync(script), `hook runs a script that does not exist: ${first}`);
      for (const flag of flags) assert.match(flag, /^--[a-z-]+$/, `hook arg is neither the script nor a flag: ${flag}`);
    }
  });
});

describe("phase A's housekeeping belongs to the supervisor", () => {
  test("queue.md names the one command a by-hand run needs", () => {
    assert.match(read(QUEUE), /npm run queue:pre/, "a by-hand /queue still needs the pre-checks");
  });

  test("it does not also ask the model to run what the supervisor already ran", () => {
    const text = read(QUEUE);
    for (const moved of ["worktrees:prune", "tools/loop/workspace.mjs"]) {
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
});

// Nine of the ten channels the supervisor reads a finished session through are inferences about a
// process that has already exited, and phase F's teardown destroys five of them at once.
describe("the session declares what it did before it exits", () => {
  const schema = JSON.parse(read("tools/loop/result-schema.json"));
  const examples = () => [...read(QUEUE).matchAll(/^\s*(\{"ticket".*\})\s*$/gm)].map((m) => m[1]);

  test("phase F asks for the declaration, in the schema's own shape", () => {
    assert.ok(examples().length, "queue.md must show the literal shape");
    assert.match(read(QUEUE), /"stoodDown":true/, "a stand-down is the case the supervisor cannot otherwise see");
  });

  // The example in the instructions is also a test fixture: a model copies its shape, so a shape
  // the schema or the reader rejects is an instruction to emit something unreadable.
  test("every example it prints is one the schema takes and the supervisor reads", () => {
    for (const example of examples()) {
      // `<n>` is the doc's placeholder for a ticket number, which is the one thing the reader needs.
      const out = JSON.parse(example.replace(/<n>/g, "7"));
      for (const field of schema.required) assert.ok(field in out, `${example} leaves out ${field}, which the schema requires`);
      for (const field of Object.keys(out)) assert.ok(field in schema.properties, `${example} names ${field}, which the schema has not`);
      const fact = readLine(JSON.stringify({ type: "result", subtype: "success", structured_output: out })) as any;
      assert.ok(fact?.declared?.ticket, `queue.md's own example does not parse: ${example}`);
    }
  });

  test("phase F declares and leaves its worktree standing for the supervisor", () => {
    const text = read(QUEUE);
    const from = text.indexOf("## F — Close out");
    assert.notEqual(from, -1, "phase F's heading has moved");
    const f = text.slice(from, text.indexOf("## Halt"));
    assert.match(f, /^\s*\{"ticket".*\}\s*$/m, "phase F no longer asks for the declaration");
    assert.doesNotMatch(f, /worktrees:remove|Tear down your worktree/);
  });

  /**
   * The general form of the defect, and the only one a reader would not catch: two sections of one
   * document both instructing the session what its final output is. Both were obeyable, the session
   * obeyed the later one, and the declaration — the supervisor's only channel that is a statement
   * rather than an inference — reached it in two runs of nineteen.
   *
   * A protocol document needs a test that the protocol it describes is self-consistent, the same
   * way `rulesAreSingleSourced.test.ts` pins the rules list.
   */
  test("every instruction to emit a line is bound to the structured output the supervisor reads", () => {
    const text = read(QUEUE);
    // Instructions to *emit*, not prose that happens to use the words: "the last thing you emit",
    // "Between tickets, exactly one line". Prose about a shell command's last line is neither.
    const instructions = [...text.matchAll(/^.*\b(?:you emit|exactly one line)\b.*$/gim)];
    assert.ok(instructions.length > 0, "nothing in queue.md says what the session emits any more");
    // Within the instruction's own paragraph, because the binding may sit a line away.
    const WINDOW = 200;
    const orphans = instructions
      .filter((m) => !text.slice(Math.max(0, m.index - WINDOW), m.index + WINDOW).includes("structured output"))
      .map((m) => m[0].trim());
    assert.deepEqual(
      orphans,
      [],
      "a second instruction claims the session's output; the supervisor only reads the structured output",
    );
  });

  test("the Output section points at the declaration rather than asking for a summary of its own", () => {
    const text = read(QUEUE);
    const from = text.indexOf("## Output");
    assert.notEqual(from, -1, "the Output section has moved");
    const out = text.slice(from);
    assert.match(out, /structured output/, "Output must defer to the declaration");
    assert.doesNotMatch(
      out,
      /^\s*`?[✅✓]\s*#</m,
      "the between-tickets summary line is what the declaration lost the final line to",
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
  test("phase C checks completeness, commits before the check, ticks the DoD, and gates last", () => {
    const c = read(QUEUE).split("## C — Build")[1]?.split("## D — Review")[0] ?? "";
    const at = ["completeness check", "commit the last slice", "npm run agent:check", "DOD-CHECK <sha>", "loop-gate.mjs --build", "handoff D"].map((s) =>
      c.lastIndexOf(s),
    );
    assert.ok(at.every((i, k) => i >= 0 && (k === 0 || i > at[k - 1])), `out of order: ${at.join(", ")}`);
  });

  // An open pull request is what the supervisor settles: one opened mid-C turns a refused or stalled build into a CI round.
  test("phase C never opens the pull request; the supervisor does at the D handoff", () => {
    const c = read(QUEUE).split("## C — Build")[1]?.split("## D — Review")[0] ?? "";
    assert.doesNotMatch(c, /gh pr create/);
  });

  test("files nothing as agent work", () => {
    const work = read(QUEUE).split("### How to work")[1]?.split("### Leaving C")[0] ?? "";
    assert.match(work, /--label ready-for-human`/);
    assert.doesNotMatch(work, /--label ready-for-agent/);
  });

  test("no phase hands off to E: a LAND lands in the same process", () => {
    assert.doesNotMatch(read(QUEUE), /"handoff":"E"/);
  });

  test("the posted review sorts its findings", () => {
    const d = read(QUEUE).split("## D — Review")[1]?.split("## E — Land")[0] ?? "";
    assert.match(d, /REVIEW <sha>\s+## Blocking[\s\S]*## Nits[\s\S]*## Pre-existing/);
  });

  test("no session marks the draft ready: that is the supervisor's, behind the LAND check", () => {
    assert.doesNotMatch(read(QUEUE), /gh pr ready/);
  });

  test("the doc states neither Bash timeout figure", () => {
    const doc = read(QUEUE);
    for (const ms of [CHECK_BASH_TIMEOUT_MS, BASH_DEFAULT_TIMEOUT_MS]) {
      assert.ok(!doc.includes(String(ms)), `queue.md teaches the literal ${ms}`);
      assert.doesNotMatch(doc, new RegExp(`\\b${ms / 60_000}[- ]minutes?\\b`));
    }
    assert.doesNotMatch(doc, /\b(one|two|three|five|ten)[- ]minute default/);
  });

  test("the log path it names is the one the supervisor writes", () => {
    const named = /\.loop-logs\/ci-<n>\.log/.exec(read(QUEUE))?.[0];
    assert.ok(named, "queue.md never tells the fix session where its CI log is");
    assert.equal(ciLogPath(953).replace(/\\/g, "/"), named.replace("<n>", "953"));
  });
});

describe("every subagent brief comes from brief.mjs", () => {
  const queue = () => read(QUEUE);
  test("queue.md quotes no brief text of its own", () => {
    assert.doesNotMatch(queue(), /^> (Investigate issue|For each Definition-of-done box|For each finding below)/m);
  });
  test("phases B, C and D each name brief.mjs with their kinds", () => {
    for (const kind of ["scope", "completeness", "review", "fix"]) {
      assert.match(queue(), new RegExp(`brief\\.mjs ${kind}\\b`), kind);
    }
  });
  test("phase B never splits a ticket into new ones", () => {
    const b = queue().split("## B — Scope")[1]?.split("## C — Build")[0] ?? "";
    assert.doesNotMatch(b, /gh issue create|split/);
  });
});

describe("the supervisor tears the worktree down", () => {
  test("with the script that detaches the junction first", () => {
    assert.match(read("tools/loop/queue-loop.mjs"), /"worktrees:remove", "--"/);
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

// Rule 2 wins over any command file, but a session follows the line it is reading.
describe("no instruction runs a suite rule 2 forbids", () => {
  const rule2 = /^2\. \*\*Never run a whole suite[\s\S]*?(?=^3\. )/m.exec(read("docs/agents/RULES.md"))?.[0] ?? "";
  const suites = [...rule2.matchAll(/`npm (?:run )?([\w:-]+)`/g)].map((m) => m[1]);
  const runs = (line: string) =>
    suites.flatMap((s) =>
      [...line.matchAll(new RegExp(`(?:npm (?:run )?|--also[ =])${s}(?![\\w:-])`, "g"))].map((m) => ({ at: m.index ?? 0, said: m[0] })),
    );
  const found = (file: string, keep: (line: string, at: number) => boolean = () => true) =>
    read(file)
      .split("\n")
      .flatMap((l, i) => runs(l).filter((r) => keep(l, r.at)).map((r) => `${file}:${i + 1}: ${r.said}`));

  test("rule 2 still names the suites", () => {
    assert.ok(suites.length >= 4 && suites.includes("loop:test") && suites.includes("test:native"), suites.join(", "));
  });

  test("the scan sees a suite given as a command or as --also, and not a script that only starts with its name", () => {
    assert.deepEqual(runs("`npm run agent:check -- --also test:native`").map((r) => r.said), ["--also test:native"]);
    assert.equal(runs("npm test").length, 1);
    assert.equal(runs("`npm run test:native:related`").length, 0);
  });

  test("no command file gives one", () => {
    const dir = ".claude/commands";
    assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith(".md")).flatMap((f) => found(`${dir}/${f}`)), []);
  });

  test("checks.md tells no one to run one, in a table's Run column or a sentence", () => {
    const told = (line: string, at: number) => /^\s*\||\b[Rr]un\b[^.;:|]*$/.test(line.slice(0, at));
    assert.ok(told("| x | `", 6) && told("**Run `", 7) && !told("`npm test`'s", 1), "the instruction test has drifted");
    assert.deepEqual(found("docs/agents/checks.md", told), []);
  });
});

test("queue.md reads CI-RED's on main: line and knows no shared issue", () => {
  const q = read(QUEUE);
  assert.match(q, /`on main:`/);
  assert.match(q, /`flaky on main:`[^.]*neither this diff's nor this round's/);
  assert.doesNotMatch(q, /shared:|shared issue|owned here/);
});

test("queue.md quotes CI-RED's rerun line in both the forms ciRedBody writes it", () => {
  const q = read(QUEUE);
  for (const attempt of [1, 2]) {
    const line = /^rerun: .+$/m.exec(ciRedBody({ sha: "a", runUrl: "u", runId: 1, attempt }))?.[0] ?? "(no rerun line)";
    assert.ok(q.includes(`\`${line}\``), line);
  }
});
