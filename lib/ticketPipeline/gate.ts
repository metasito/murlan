import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SCHEMA_FILE = "shared/schema.ts";
const SOCKET_PATTERN = /server\/socket|shared\/events\.ts/;
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

  if (ticket.filesTouched.includes(SCHEMA_FILE)) {
    return { escalate: true, reason: `touches ${SCHEMA_FILE} with no recorded decision` };
  }
  if (ticket.filesTouched.some((f) => SOCKET_PATTERN.test(f))) {
    return { escalate: true, reason: "touches the socket protocol with no recorded decision" };
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
