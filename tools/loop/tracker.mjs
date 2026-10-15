/**
 * Every label the loop moves on a ticket, and the comments it posts, behind one interface: `ghTracker`
 * over the real `gh`, `fakeTracker` in memory. The label set is `docs/agents/issue-tracker.md`'s.
 */
import { gh as ghCli } from "./cli.mjs";

/** `[remove, add]` for each transition, read by both trackers so they cannot drift apart. */
const TRANSITIONS = {
  claim: [[], ["in-progress"]],
  release: [["in-progress"], []],
  // Left on, `ready-for-agent` makes a park absorbing: classify() sends any issue carrying an owner
  // label to the owner bucket whatever else it carries, so the ticket never returns to the frontier.
  park: [["in-progress", "ready-for-agent"], ["ready-for-human"]],
};

/** @param {(args: string[], opts?: object) => string} [gh] */
export function ghTracker(gh = ghCli) {
  const move = (name) => (n) => {
    const [remove, add] = TRANSITIONS[name];
    return gh([
      "issue",
      "edit",
      String(n),
      ...remove.flatMap((l) => ["--remove-label", l]),
      ...add.flatMap((l) => ["--add-label", l]),
    ]);
  };
  return {
    claim: move("claim"),
    release: move("release"),
    park: move("park"),
    comment: (n, bodyFile) => gh(["issue", "comment", String(n), "--body-file", bodyFile]),
    /** @returns {{state: string, labels: string[]}} */
    issue: (n, opts) => {
      const { state, labels } = JSON.parse(gh(["issue", "view", String(n), "--json", "state,labels"], opts));
      return { state, labels: labels.map((l) => l.name) };
    },
  };
}

/**
 * Issues held in memory; an issue not seeded starts open and unlabelled. Each operation named in
 * `fail` throws and changes nothing. `held(n)` is what a test asserts on.
 *
 * @param {Record<number, {state?: string, labels?: string[]}>} [issues]
 * @param {{fail?: string[]}} [opts]
 */
export function fakeTracker(issues = {}, { fail = [] } = {}) {
  const held = new Map();
  const at = (n) => {
    if (!held.has(n)) {
      const seed = issues[n] ?? {};
      held.set(n, { state: seed.state ?? "OPEN", labels: new Set(seed.labels ?? []), comments: [] });
    }
    return held.get(n);
  };
  const op = (name, fn) => (n, ...rest) => {
    if (fail.includes(name)) throw new Error(`tracker refused ${name} on #${n}`);
    return fn(at(n), ...rest);
  };
  const move = (name) =>
    op(name, (issue) => {
      const [remove, add] = TRANSITIONS[name];
      for (const l of remove) issue.labels.delete(l);
      for (const l of add) issue.labels.add(l);
    });
  return {
    claim: move("claim"),
    release: move("release"),
    park: move("park"),
    comment: op("comment", (issue, bodyFile) => void issue.comments.push(bodyFile)),
    issue: op("issue", (issue) => ({ state: issue.state, labels: [...issue.labels] })),
    held: (n) => {
      const issue = at(n);
      return { state: issue.state, labels: [...issue.labels].sort(), comments: [...issue.comments] };
    },
  };
}
