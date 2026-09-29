// The Lantern Table mockup (tests/e2e/fixtures/lantern-table/index.html) is the specification
// (#1252). This lifts its own source lines out of it, so a test compares against the numbers the
// mockup runs rather than a copy of them.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const FIXTURE = path.resolve(import.meta.dirname, "..", "e2e", "fixtures", "lantern-table", "index.html");
const source = fs.readFileSync(FIXTURE, "utf8");

/** The one line of the mockup's script that starts with `prefix`. */
export function fixtureLine(prefix: string): string {
  const lines = source.split("\n").filter((l) => l.startsWith(prefix));
  if (lines.length !== 1) throw new Error(`${lines.length} lines of the mockup start with ${prefix}`);
  return lines[0];
}

/** The statement starting at `prefix`, through the line that closes it. */
export function fixtureBlock(prefix: string, endsWith: string): string {
  const start = source.indexOf(prefix);
  if (start < 0) throw new Error(`the mockup has no ${prefix}`);
  const end = source.indexOf(endsWith, start);
  if (end < 0) throw new Error(`${prefix} never reaches ${endsWith}`);
  return source.slice(start, end + endsWith.length);
}

/** Runs mockup statements in a fresh context and returns it. */
export function runFixture(statements: string[], globals: Record<string, unknown> = {}): Record<string, unknown> {
  const context = vm.createContext({ Math, ...globals });
  vm.runInContext(statements.join("\n").replace(/^(const|let) /gm, "var "), context);
  return context;
}
