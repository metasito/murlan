// tests/nextTicket.test.ts — #293: the repo went public and a drive-by
// issue arrives with no labels at all. `classify` fell through every branch
// into `owner`, the bucket that means "stop, a human decides" — a stranger's
// bug report was never triaged, and sat behind everything else while quietly
// counting against the "no takeable work" check.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { classify, pickRoute, isInvokedDirectly } from "../scripts/next-ticket.mjs";

function issue(number: number, labelNames: string[]) {
  return { number, title: `issue ${number}`, labels: labelNames.map((name) => ({ name })) };
}

describe("classify's bucketing", () => {
  test("an unlabelled issue routes to triage, not to the owner", () => {
    const buckets = classify([issue(1, [])]);

    assert.deepEqual(buckets.owner, []);
    assert.equal(buckets.triage.length, 1);
    assert.equal(buckets.triage[0].number, 1);
  });

  test("an explicit needs-triage label still routes to triage", () => {
    const buckets = classify([issue(2, ["needs-triage"])]);

    assert.equal(buckets.triage.length, 1);
    assert.equal(buckets.triage[0].number, 2);
  });

  test("triage still precedes wayfinder when both have work", () => {
    // Precedence is deliberate, not incidental — per the ordering comment
    // above `classify`.
    const buckets = classify([issue(3, []), issue(4, ["wayfinder:research"])]);

    const route = pickRoute(buckets);
    assert.equal(route.skill, "triage");
    assert.equal(route.ticket.number, 3);
  });

  test("an owner-gated label still routes to owner", () => {
    const buckets = classify([issue(5, ["ready-for-human"])]);

    assert.equal(buckets.owner.length, 1);
    assert.equal(buckets.owner[0].number, 5);
  });

  test("ready-for-agent still wins over an unlabelled issue", () => {
    const buckets = classify([issue(6, ["ready-for-agent", "size:S"]), issue(7, [])]);

    assert.equal(buckets.frontier.length, 1);
    assert.equal(buckets.frontier[0].number, 6);
    assert.equal(buckets.triage.length, 1);
    assert.equal(buckets.triage[0].number, 7);
  });

  test("in-progress and blocked are still skipped regardless of other labels", () => {
    const buckets = classify([
      issue(8, ["in-progress"]),
      issue(9, ["ready-for-agent", "blocked"]),
    ]);

    assert.equal(buckets.frontier.length, 0);
    assert.equal(buckets.triage.length, 0);
    assert.equal(buckets.wayfinder.length, 0);
    assert.equal(buckets.owner.length, 0);
  });
});

describe("isInvokedDirectly", () => {
  test("is true only when argv1 resolves to the module's own path", () => {
    const self = path.resolve("scripts/next-ticket.mjs");
    const moduleUrl = pathToFileURL(self).href;

    assert.equal(isInvokedDirectly(self, moduleUrl), true);
    assert.equal(isInvokedDirectly(path.resolve("scripts/other.mjs"), moduleUrl), false);
    assert.equal(isInvokedDirectly(undefined, moduleUrl), false);
  });
});
