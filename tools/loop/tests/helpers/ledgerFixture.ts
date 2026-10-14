import { readFileSync } from "node:fs";
import path from "node:path";

const PROSE = /phase\s+([A-Za-z])\s+next(?: — (.+))?/;

/** A recorded ledger, its pre-schema-6 prose handoffs lifted into the `handoff` field the reader requires. */
export function ledgerFixture(name: string): any[] {
  return readFileSync(path.join(import.meta.dirname, "..", "fixtures", name), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l))
    .map((r) => {
      const m = r.outcome === "handoff" && !r.handoff ? PROSE.exec(r.park_reason ?? "") : null;
      return m ? { ...r, handoff: { phase: m[1], why: m[2] ?? null, said: null } } : r;
    });
}
