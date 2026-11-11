// What `tests/e2e/57-polish-audit/online-table.txt` holds and how rows merge into it: one module,
// read by the survey that writes the record and by `scripts/regen.ts`, which applies the rows a
// CI run measured. Free of Playwright so `node` can load it (docs/agents/checks.md § Node's
// TypeScript loader reaches plain `.ts` only).

export const ONLINE_TABLE = "tests/e2e/57-polish-audit/online-table.txt";
/** The survey leaves its measured rows under this name in each test's output dir, which CI keeps when the suite goes red. */
export const MEASURED_ROWS = "online-table.rows.txt";

/** The audit's own four, named as `content.txt` and `table.txt` name them. */
export const VIEWPORTS = [
  { name: "phone-se", width: 568, height: 320 },
  { name: "phone-12", width: 844, height: 390 },
  { name: "phone-max", width: 956, height: 440 },
  { name: "tablet", width: 1112, height: 834 },
] as const;

/**
 * `MODE\tviewport\tcards=N`. Every seat here is a real account now (#800),
 * so a fresh 4-player deal's leader is whichever of the four `dealFirstSeat`
 * (server/game/tableLifecycle.ts) happens to give the 3♠ — two of the four seats
 * get 14 cards, two get 13 (`dealCards`, lib/game/gameEngine.ts), so the hand this
 * measures is genuinely, legitimately, either. Leaving `cards` out of the key
 * would hold a 13-card table to a 14-card table's own recorded row — the
 * exact byte-for-byte fields a fresh shuffle changed on purpose — and reds a
 * table that never drifted, on the very lottery this file exists to remove.
 */
export const keyOf = (row: string) => {
  const parts = row.split("\t");
  return [parts[0], parts[1], parts[6]].join("\t");
};

export const audited = (key: string) => VIEWPORTS.some((vp) => vp.name === key.split("\t")[1]);

export const recordOf = (text: string): Map<string, string> =>
  new Map(text.split("\n").filter(Boolean).map((l) => [keyOf(l), l]));

/**
 * `rows` merged into the record by key, never replacing it outright: a run's rows hold whichever
 * `cards` count each viewport's real deal happened to land on, and the *other* count's own row —
 * a real, already-verified table the run had no occasion to redeal — would be lost by a plain
 * overwrite rather than left standing. A viewport VIEWPORTS no longer lists is dropped.
 */
export function mergedRecord(record: string, rows: string[]): string {
  const merged = recordOf(record);
  for (const key of [...merged.keys()]) if (!audited(key)) merged.delete(key);
  for (const row of rows) merged.set(keyOf(row), row);
  return [...merged.values()].join("\n") + "\n";
}
