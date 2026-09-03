// lib/ticketPipeline/risk.ts
//
// Which changed files are worth a second reader, and how that reader's answer is read.
//
// The pipeline merges its own work on green, by the owner's decision — no human holds the
// button. That is only sound where `ci.yml` is actually competent to judge, and there is a
// class of change it cannot: one that is green and wrong by design. A rules change that
// passes every test and plays a different game, a schema change that migrates cleanly into
// the wrong shape, a socket payload that round-trips and breaks the client's contract. Only
// a reader catches those, so those paths get one.
//
// Anthropic's own published answer to merging without a per-PR human is the same shape —
// "We tier our codebase by risk, and make deliberate decisions on what parts to automate"
// (docs/research/2026-09-03-anthropic-sdlc.md) — rather than a gate on everything.

/**
 * Paths where green is not sufficient evidence.
 *
 * Deliberately short. Every entry here costs a full opus pass on any ticket that touches it,
 * so a path earns its place by being somewhere a passing suite has been wrong before, not by
 * being important. Components, screens, locales and docs are absent on purpose: a defect
 * there is visible, reversible, and the suite plus the owner's own play catches it.
 */
const HIGH_RISK = [
  // The rules. `docs/RULES.md` specifies them and a change needs a decision recorded in
  // docs/BRIEF.md §3.1 — a green suite cannot tell whether that decision was made.
  "lib/gameEngine.ts",
  // One module chooses a bot's move, for the server and the offline table both.
  "lib/autoMove.ts",
  // Server authority: everything that validates a move or sanitizes what a client is told.
  "server/",
  // The database holds real accounts, and schemaDdl is the only thing that creates tables.
  "shared/schema.ts",
  // The wire contract. Both sides compile against it; only a reader sees a broken promise.
  "shared/",
  // The pipeline's own machinery, and the checks that gate everything else. A defect here
  // is the one that cannot be caught by the thing it broke.
  "scripts/",
  "lib/ticketPipeline/",
  ".github/",
];

/** The high-risk paths this diff touches, in the order listed above. Empty is the common case. */
export function riskyPaths(changedFiles: readonly string[]): string[] {
  const normalised = changedFiles.map((f) => f.replace(/\\/g, "/"));
  return HIGH_RISK.filter((prefix) =>
    normalised.some((file) => (prefix.endsWith("/") ? file.startsWith(prefix) : file === prefix))
  );
}

export type SecondOpinion =
  | { verdict: "land"; reason: string }
  | { verdict: "hold"; reason: string };

/** The exact line the second reader is told to end on. Parsed, so it is stated in one place. */
export const VERDICT_PREFIX = "VERDICT:";

/**
 * A reviewer's closing line, read as a decision.
 *
 * An unreadable reply lands. That is the deliberate direction to fail in: the owner's standing
 * decision is that this pipeline merges its own work, so a reviewer that rambles, crashes or
 * forgets the sentinel must not be able to park the queue — a guard that stops work by going
 * wrong is worse than no guard. Only an explicit HOLD holds, and the run record says which of
 * the three happened, so a reviewer that never manages to answer is visible rather than silent.
 */
export function readSecondOpinion(reply: string): SecondOpinion {
  const lines = reply.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const verdictLine = [...lines].reverse().find((l) => l.toUpperCase().startsWith(VERDICT_PREFIX));
  if (!verdictLine) {
    return { verdict: "land", reason: "the second reader gave no verdict line; landing on the owner's default" };
  }
  const body = verdictLine.slice(VERDICT_PREFIX.length).trim();
  if (/^HOLD\b/i.test(body)) {
    const reason = body.replace(/^HOLD\b[\s—:-]*/i, "").trim();
    return { verdict: "hold", reason: reason || "the second reader held it without giving a reason" };
  }
  return { verdict: "land", reason: body || "the second reader raised nothing" };
}
