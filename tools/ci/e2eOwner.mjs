const FLAG = "--murlan-e2e-owner";

/** The argument `scripts/e2e-server.mjs` starts its server with: the run's own pid, in the one place `tools/loop/reap.mjs` reads it back. */
export function ownerArg(pid) {
  return `${FLAG}=${pid}`;
}

/** The pid named by `ownerArg` in a command line, or null for a process that carries none. */
export function ownerOf(commandLine) {
  const match = String(commandLine ?? "").match(new RegExp(`(?:^|\\s)${FLAG}=(\\d+)(?:\\s|$)`));
  return match ? Number(match[1]) : null;
}
