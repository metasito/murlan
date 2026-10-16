import { diag, type DiagRows } from "@/lib/diagnostics";
import { reportError } from "@/lib/errorReporting";

/** A table gate its frame clock never released, let go by its watchdog (`GATE_WATCHDOG_MS`). */
export function gateForced(name: DiagRows["gate"]["name"]): void {
  // `diag` records only in a diagnostics build; the report is what a shipped build sees.
  reportError(new Error(`table gate forced: ${name}`));
  diag({ k: "gate", t: performance.now(), name });
}
