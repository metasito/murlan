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

if (process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`) {
  const input = JSON.parse(process.argv[2] ?? "{}");
  process.stdout.write(JSON.stringify(needsDesignFirstGate(input)));
}
