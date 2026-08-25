import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SCHEMA_PATTERN = /(^|\/)shared\/schema\.ts$/;
const SOCKET_PATTERN = /server\/socket|shared\/events\.ts/;
const MANIFEST_PATTERN = /(^|\/)package\.json$/;
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

export function needsDesignFirstGate(ticket: TicketFacts): GateVerdict {
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
  if (ticket.filesTouched.some((f) => MANIFEST_PATTERN.test(f))) {
    return { escalate: true, reason: "changes a dependency with no recorded decision" };
  }
  if (ticket.filesTouched.length > FILE_COUNT_THRESHOLD) {
    return {
      escalate: true,
      reason: `touches ${ticket.filesTouched.length} files with no recorded decision`,
    };
  }
  return { escalate: false, reason: "" };
}

// Input arrives on stdin, never as an argv token: a caller's shell layer collapses the `\\`
// that JSON.stringify emits for a literal backslash, which makes the payload unparseable.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = JSON.parse(readFileSync(0, "utf8").trim() || "{}");
  process.stdout.write(JSON.stringify(needsDesignFirstGate(input)));
}
