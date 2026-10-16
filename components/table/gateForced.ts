import { AppState } from "react-native";
import { diag, type DiagRows } from "@/lib/diagnostics";
import { reportError } from "@/lib/errorReporting";
import { GATE_WATCHDOG_MS } from "@/lib/game/gateWatchdog";
import { inBackground } from "./useFlightClock";

/** A table gate its frame clock never released, let go by its watchdog (`GATE_WATCHDOG_MS`). */
export function gateForced(name: DiagRows["gate"]["name"]): void {
  // `diag` records only in a diagnostics build; the report is what a shipped build sees.
  reportError(new Error(`table gate forced: ${name}`));
  diag({ k: "gate", t: performance.now(), name });
}

/**
 * Calls `fire` once `GATE_WATCHDOG_MS` of visible time has passed; returns its cancel. A hidden page
 * draws no frames but still runs timers, so the wait restarts whole on every change of page state.
 */
export function armGateWatchdog(fire: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => (inBackground() ? arm() : fire()), GATE_WATCHDOG_MS);
  };
  const changes = AppState.addEventListener("change", arm);
  arm();
  return () => {
    clearTimeout(timer);
    changes.remove();
  };
}
