import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SCHEMA_PATTERN = /(^|\/)shared\/schema\.ts$/;
const SOCKET_PATTERN = /server\/socket|shared\/events\.ts/;
const MANIFEST_PATTERN = /(^|\/)package\.json$/;
// package.json holds scripts, engines and config as well as dependencies, and the path alone
// cannot say which a ticket means. #278 adds one npm script and installs nothing; the path on its
// own sent it to the owner for a decision it had already written down.
const DEPENDENCY_LANGUAGE = /\b(dependenc(y|ies)|devDependenc|npm (i|install|add)\b|yarn add)/i;
const FILE_COUNT_THRESHOLD = 6;
const DECISION_POINTER = /docs\/BRIEF\.md\s*§|docs\/adr\/|Design decision:/;

export interface TicketFacts {
  filesTouched: string[];
  body: string;
}

export interface GateVerdict {
  escalate: boolean;
  reason: string;
}

const LOCALE_PATTERN = /(^|\/)locales\/[a-z]{2}\.ts$/;

/**
 * How many decisions a file list really represents. Every user-facing string is keyed in all
 * three locales, and `it.ts`/`sq.ts` are `Record<keyof typeof en, string>` — a gap is a compile
 * error, not a design question. Counted one each they spend half the threshold before the change
 * itself has a file, and a four-file chip label escalated at seven.
 */
export function countSurfaces(filesTouched: string[]): number {
  const locales = filesTouched.filter((f) => LOCALE_PATTERN.test(f)).length;
  return filesTouched.length - Math.max(0, locales - 1);
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

  const hasDecision = DECISION_POINTER.test(ticket.body);
  if (hasDecision) return { escalate: false, reason: "" };

  if (ticket.filesTouched.some((f) => SCHEMA_PATTERN.test(f))) {
    return { escalate: true, reason: "touches shared/schema.ts with no recorded decision" };
  }
  if (ticket.filesTouched.some((f) => SOCKET_PATTERN.test(f))) {
    return { escalate: true, reason: "touches the socket protocol with no recorded decision" };
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
  const surfaces = countSurfaces(ticket.filesTouched);
  if (surfaces > FILE_COUNT_THRESHOLD) {
    return { escalate: true, reason: `touches ${surfaces} files with no recorded decision` };
  }
  return { escalate: false, reason: "" };
}

// Input arrives on stdin, never as an argv token: a caller's shell layer collapses the `\\`
// that JSON.stringify emits for a literal backslash, which makes the payload unparseable.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = JSON.parse(readFileSync(0, "utf8").trim() || "{}");
  process.stdout.write(JSON.stringify(needsDesignFirstGate(input)));
}
