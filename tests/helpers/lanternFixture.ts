// The Lantern Table mockup (tests/e2e/fixtures/lantern-table/index.html) is the specification
// (#1252), and the materials mockup (felt-and-card-materials) the card backs'. This lifts their own
// source lines out, so a test compares against the numbers a mockup runs rather than a copy of them.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

function mockup(name: string) {
  const source = fs.readFileSync(path.resolve(import.meta.dirname, "..", "e2e", "fixtures", name, "index.html"), "utf8");
  return {
    /** The one line of the mockup's script that starts with `prefix`. */
    line(prefix: string): string {
      const lines = source.split("\n").filter((l) => l.startsWith(prefix));
      if (lines.length !== 1) throw new Error(`${lines.length} lines of ${name} start with ${prefix}`);
      return lines[0];
    },
    /** The statement starting at `prefix`, through the line that closes it. */
    block(prefix: string, endsWith: string): string {
      const start = source.indexOf(prefix);
      if (start < 0) throw new Error(`${name} has no ${prefix}`);
      const end = source.indexOf(endsWith, start);
      if (end < 0) throw new Error(`${prefix} never reaches ${endsWith}`);
      return source.slice(start, end + endsWith.length);
    },
  };
}

const lantern = mockup("lantern-table");
export const fixtureLine = lantern.line;
export const fixtureBlock = lantern.block;
export const materialsLine = mockup("felt-and-card-materials").line;

/** Runs mockup statements in a fresh context and returns it. */
export function runFixture(statements: string[], globals: Record<string, unknown> = {}): Record<string, unknown> {
  const context = vm.createContext({ Math, ...globals });
  vm.runInContext(statements.join("\n").replace(/^(const|let) /gm, "var "), context);
  return context;
}
