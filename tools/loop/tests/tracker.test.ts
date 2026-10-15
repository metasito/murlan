import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { fakeTracker, ghTracker } from "../tracker.mjs";

/** A `gh` holding one issue's labels, so the real adapter is judged by the state its argv leaves. */
const ghHolding = (state: string, labels: string[]) => {
  const held = new Set(labels);
  const argv: string[][] = [];
  const gh = (args: string[]) => {
    argv.push(args);
    if (args[1] === "view") return JSON.stringify({ state, labels: [...held].map((name) => ({ name })) });
    if (args[1] === "edit") {
      args.forEach((a, i) => {
        if (a === "--remove-label") held.delete(args[i + 1]);
        if (a === "--add-label") held.add(args[i + 1]);
      });
    }
    return "";
  };
  return { gh, argv, held: () => [...held].sort() };
};

describe("the gh tracker and the fake agree on every transition", () => {
  const start = ["ready-for-agent", "size:S"];
  const cases: [string, (t: ReturnType<typeof fakeTracker>) => unknown, string[]][] = [
    ["claim", (t) => t.claim(7), ["in-progress", "ready-for-agent", "size:S"]],
    ["release", (t) => (t.claim(7), t.release(7)), ["ready-for-agent", "size:S"]],
    ["park", (t) => (t.claim(7), t.park(7)), ["ready-for-human", "size:S"]],
  ];
  for (const [name, act, after] of cases) {
    test(name, () => {
      const real = ghHolding("OPEN", start);
      act(ghTracker(real.gh) as ReturnType<typeof fakeTracker>);
      const fake = fakeTracker({ 7: { labels: start } });
      act(fake);
      assert.deepEqual(real.held(), after, "gh");
      assert.deepEqual(fake.held(7).labels, after, "fake");
    });
  }

  test("issue reads state and label names", () => {
    const real = ghHolding("CLOSED", ["in-progress"]);
    assert.deepEqual(ghTracker(real.gh).issue(7), { state: "CLOSED", labels: ["in-progress"] });
    assert.deepEqual(fakeTracker({ 7: { state: "CLOSED", labels: ["in-progress"] } }).issue(7), {
      state: "CLOSED",
      labels: ["in-progress"],
    });
  });
});

test("a comment goes through a file, never an inline body", () => {
  const real = ghHolding("OPEN", []);
  ghTracker(real.gh).comment(7, "note.md");
  assert.deepEqual(real.argv, [["issue", "comment", "7", "--body-file", "note.md"]]);
});

test("the fake refuses the operations it is told to, and changes nothing for them", () => {
  const t = fakeTracker({ 7: { labels: ["in-progress"] } }, { fail: ["comment"] });
  assert.throws(() => t.comment(7, "note.md"), /comment/);
  t.park(7);
  assert.deepEqual(t.held(7), { state: "OPEN", labels: ["ready-for-human"], comments: [] });
});
