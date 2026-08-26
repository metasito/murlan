// tests/ticketPipelinePrompts.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const PIPELINE = ".claude/workflows/ticket-pipeline.mjs";

function source(): string {
  return readFileSync(PIPELINE, "utf8");
}

describe("the ticket pipeline's stage prompts", () => {
  // The prompts are template literals full of backticked prose, and an unescaped one closes the
  // string. Nothing else here can see that: the file is not typechecked, not linted and not
  // imported, so a broken quote surfaces only when a run launches and dies on the first stage.
  // `node --check` cannot judge it either — a workflow body is allowed a top-level return.
  test("the script parses as a workflow body", () => {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as FunctionConstructor;
    const body = source().replace(/^export const meta/m, "const meta");
    assert.doesNotThrow(
      () => new AsyncFunction("agent", "parallel", "pipeline", "log", "phase", "args", body),
      `${PIPELINE} does not parse. An unescaped backtick inside a stage prompt is the usual cause.`
    );
  });

  // A stage that dispatches a reviewer gets no completion signal back: the run that added one
  // spent six minutes of its most expensive model sleeping and polling `git status` for a child
  // it then had to kill. The workflow's own `agent()` is the await, so a review is a phase.
  test("no stage dispatches a reviewer sub-agent", () => {
    const dispatches = source()
      .split("\n")
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => /\b(run|dispatch|invoke)\b.*\/code-review/i.test(line))
      // A line forbidding the dispatch is the fix, not the defect — the implement stage carries
      // one — so an imperative negated on the same line is left alone.
      .filter(([, line]) => !/\bnot\b/i.test(line));
    assert.deepEqual(
      dispatches.map(([n]) => n),
      [],
      `${PIPELINE}:${dispatches.map(([n]) => n).join(",")} tells a stage to run /code-review. A ` +
        `reviewer dispatched from inside a stage cannot be awaited; review the diff in the stage ` +
        `itself, or give it a phase of its own.`
    );
  });

  // Review cannot know what Implement already proved, so it re-proves it: the two-minute native
  // suite ran three times per ticket across #211 and #212, and `agent:check` three times. The
  // list travels between the stages instead of each one deciding alone.
  test("the review stage is handed what the implement stage already ran", () => {
    const body = source();
    assert.match(body, /checksRun/, "IMPLEMENT_SCHEMA does not carry the checks that were run");
    assert.match(
      body,
      /\$\{[^}]*checksRun[^}]*\}/,
      "the review prompt never interpolates impl.checksRun, so the list is collected and dropped"
    );
  });

  // Both stages that touch the tree locally ran suites the ticket never asked for — including the
  // two-minute native one, against a two-line diff. Whatever names the checks has to reach them.
  test("every stage that checks its work is told where the check list lives", () => {
    const noteUses = source().match(/\$\{LOCAL_TEST_NOTE\}/g) ?? [];
    assert.ok(
      noteUses.length >= 3,
      `only ${noteUses.length} stage(s) interpolate LOCAL_TEST_NOTE; implement, review and fix ` +
        `all run local checks, and a stage without it rediscovers the list or runs everything.`
    );
  });
});
