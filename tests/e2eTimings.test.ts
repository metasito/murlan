import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { coverageGap, timingsFromReport } from "../scripts/e2e-timings.mjs";

/** The shape `playwright merge-reports --reporter json` produces: one suite per file. */
function report(files: Record<string, { title: string; status?: string; ms: number[] }[]>) {
  return {
    suites: Object.entries(files).map(([file, specs]) => ({
      file,
      title: file,
      specs: [],
      suites: [
        {
          file,
          title: "describe",
          specs: specs.map(({ title, status, ms }) => ({
            title,
            tests: [{ status: status ?? "expected", results: ms.map((duration) => ({ duration })) }],
          })),
        },
      ],
    })),
  };
}

describe("reading a run's durations", () => {
  test("sums every test in a file, in seconds", () => {
    const { seconds } = timingsFromReport(
      report({ "a.spec.ts": [{ title: "one", ms: [1200] }, { title: "two", ms: [3400] }] })
    );

    assert.deepEqual(seconds, { "a.spec.ts": 4.6 });
  });

  test("counts a retried test's every attempt, which is what the shard spent", () => {
    const { seconds } = timingsFromReport(report({ "a.spec.ts": [{ title: "flaky", ms: [5000, 4000] }] }));

    assert.deepEqual(seconds, { "a.spec.ts": 9 });
  });

  test("finds specs however deeply describe blocks nest them", () => {
    const nested = report({ "a.spec.ts": [{ title: "deep", ms: [2000] }] });
    nested.suites[0].suites[0] = {
      file: "a.spec.ts",
      title: "outer",
      specs: [],
      suites: [nested.suites[0].suites[0]],
    } as never;

    assert.deepEqual(timingsFromReport(nested).seconds, { "a.spec.ts": 2 });
  });

  test("refuses a report with no specs in it at all", () => {
    assert.throws(() => timingsFromReport({ suites: [] }), /no spec files/);
  });
});

describe("a run that cannot price a file", () => {
  test("leaves out a file whose run skipped a test, and says which", () => {
    // menuHeight.spec.ts decides at runtime, so this is not hypothetical: the
    // file it hits changes from run to run. Priced on what did run, it would
    // read as measured and sink below its real cost.
    const { seconds, unpriced } = timingsFromReport(
      report({
        "a.spec.ts": [
          { title: "ran", ms: [4000] },
          { title: "no slack to strand", status: "skipped", ms: [0] },
        ],
      })
    );

    assert.deepEqual(seconds, {});
    assert.match(unpriced["a.spec.ts"], /skipped "no slack to strand"/);
  });

  test("leaves out a file that rounds to nothing rather than calling it free", () => {
    // musicLoops.spec.ts decodes three tracks in `beforeAll` and leaves its test
    // bodies arithmetic. `assignShards` reads 0 as free and would stack the file
    // with real work — the defect #753 is about, through another door.
    const { seconds, unpriced } = timingsFromReport(report({ "a.spec.ts": [{ title: "quick", ms: [40] }] }));

    assert.deepEqual(seconds, {});
    assert.match(unpriced["a.spec.ts"], /outside its test bodies/);
  });

  test("prices a file that only just clears rounding", () => {
    const { seconds, unpriced } = timingsFromReport(report({ "a.spec.ts": [{ title: "quick", ms: [50] }] }));

    assert.deepEqual(seconds, { "a.spec.ts": 0.1 });
    assert.deepEqual(unpriced, {});
  });
});

describe("covering the suite", () => {
  test("names what nothing has measured", () => {
    const gap = coverageGap({ "a.spec.ts": 1 }, ["a.spec.ts", "b.spec.ts", "c.spec.ts"]);

    assert.match(gap ?? "", /1 of the suite's 3 specs/);
    assert.match(gap ?? "", /b\.spec\.ts, c\.spec\.ts/);
  });

  test("counts the suite's own specs, not a deleted one the report still carries", () => {
    const gap = coverageGap({ "a.spec.ts": 1, "gone.spec.ts": 9 }, ["a.spec.ts", "b.spec.ts"]);

    assert.match(gap ?? "", /1 of the suite's 2 specs/);
  });

  test("a set covering the whole suite has no gap", () => {
    assert.equal(coverageGap({ "a.spec.ts": 1, "b.spec.ts": 2 }, ["a.spec.ts", "b.spec.ts"]), null);
  });
});
