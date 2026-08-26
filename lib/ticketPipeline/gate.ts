import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SCHEMA_PATTERN = /(^|\/)shared\/schema\.ts$/;
const MANIFEST_PATTERN = /(^|\/)package\.json$/;
// package.json holds scripts, engines and config as well as dependencies, and the path alone
// cannot say which a ticket means. #278 adds one npm script and installs nothing; the path on its
// own sent it to the owner for a decision it had already written down.
const DEPENDENCY_LANGUAGE = /\b(dependenc(y|ies)|devDependenc|npm (i|install|add)\b|yarn add)/i;
const DECISION_POINTER = /docs\/BRIEF\.md\s*§|docs\/adr\/|Design decision:/;

/**
 * `body` is the ticket's own specification. `comments` are everything said about it afterwards —
 * including this gate's own escalation notices, which name the very words some rules match on.
 * Concatenated, the gate re-read its output as input and escalated #278 twice on five
 * dependency-language hits, none of which came from the specification. Each rule below states
 * which of the two it reads, and why.
 */
export interface TicketFacts {
  filesTouched: string[];
  body: string;
  comments?: string;
}

export interface GateVerdict {
  escalate: boolean;
  reason: string;
}

/**
 * Decisions the ticket still names as open. `ready-for-agent` promises they are made, so a body
 * that still asks reaches an agent with two readings and no way to choose between them.
 * Deliberately not suppressed by a recorded decision elsewhere: an ADR about one part of a
 * ticket says nothing about the boxes open in another.
 */
export function unsettledDecisions(body: string): number {
  const heading = /^##\s+What to settle\s*$/im.exec(body);
  if (!heading) return 0;
  const rest = body.slice(heading.index + heading[0].length);
  const next = /^##\s+/m.exec(rest);
  const section = next ? rest.slice(0, next.index) : rest;
  return (section.match(/^\s*-\s*\[ \]/gm) ?? []).length;
}

export function needsDesignFirstGate(ticket: TicketFacts): GateVerdict {
  const open = unsettledDecisions(ticket.body);
  if (open > 0) {
    return { escalate: true, reason: `carries ${open} unsettled decision(s) under "What to settle"` };
  }

  // Comments too: an owner's ruling arrives as one, and it has to be able to clear a gate the
  // body alone would trip. This is the one rule that gains from reading them.
  const hasDecision = DECISION_POINTER.test(`${ticket.body}\n${ticket.comments ?? ""}`);
  if (hasDecision) return { escalate: false, reason: "" };

  if (ticket.filesTouched.some((f) => SCHEMA_PATTERN.test(f))) {
    return { escalate: true, reason: "touches shared/schema.ts with no recorded decision" };
  }
  // A dependency is production's problem, not the diff's: Replit runs Node 22 from the Run
  // button with no build step, so the wrong package is discovered there rather than in CI. Left
  // undecided it is also the most expensive thing an implement agent can meet — #342 spent a
  // fifth of its run reading a package's source to work out whether to add one at all.
  const weighsADependency =
    ticket.filesTouched.some((f) => MANIFEST_PATTERN.test(f)) && DEPENDENCY_LANGUAGE.test(ticket.body);
  if (weighsADependency) {
    return { escalate: true, reason: "changes a dependency with no recorded decision" };
  }
  return { escalate: false, reason: "" };
}

// Paths a ticket names, so the rules above can run before an agent has written anything. A file
// named in a ticket is not proof it will be edited, but the rules that read this list are path
// patterns over a handful of files — `shared/schema.ts`, the socket protocol, the manifest — and a
// ticket that names one of those almost always means to change it.
const PATH_IN_PROSE = /(?:[\w.-]+\/)*[\w.-]+\.(?:tsx?|jsx?|mjs|json|ya?ml)\b/g;

export function filesNamedIn(body: string): string[] {
  return [...new Set(body.match(PATH_IN_PROSE) ?? [])];
}

// Input arrives on stdin, never as an argv token: a caller's shell layer collapses the `\\`
// that JSON.stringify emits for a literal backslash, which makes the payload unparseable.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = JSON.parse(readFileSync(0, "utf8").trim() || "{}");
  process.stdout.write(JSON.stringify(needsDesignFirstGate(input)));
}
