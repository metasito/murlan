import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fromCodeql, fromDepcruise, fromJscpd, fromKnip } from "../../tools/audit/staticLayer.mjs";

test("each tool's output becomes path:line alerts", () => {
  const root = path.resolve("r");
  assert.deepEqual(
    fromDepcruise({ summary: { totalCruised: 3, violations: [{ from: "shared/a.ts", to: "src/b.ts", rule: { name: "shared-is-a-leaf" } }] } }),
    [{ tool: "dependency-cruiser", rule: "shared-is-a-leaf", path: "shared/a.ts", line: 1, message: "shared/a.ts -> src/b.ts" }],
  );
  assert.deepEqual(
    fromKnip({ issues: [{ file: "src/x.ts", exports: [{ name: "unused", line: 7 }], duplicates: [[{ name: "A", line: 2 }, { name: "B", line: 3 }]], types: [] }] })
      .map((a) => `${a.rule} ${a.path}:${a.line} ${a.message}`),
    ["exports src/x.ts:7 exports: unused", "duplicates src/x.ts:2 duplicates: A", "duplicates src/x.ts:3 duplicates: B"],
  );
  assert.deepEqual(
    fromJscpd({ statistics: { total: { sources: 2 } }, duplicates: [{ lines: 9, firstFile: { name: `${path.sep}${path.sep}?${path.sep}${path.join(root, "app", "a.tsx")}`, start: 4 }, secondFile: { name: path.join(root, "app", "b.tsx"), start: 40 } }] }, root)
      .map((a) => `${a.path}:${a.line} ${a.message}`),
    ["app/a.tsx:4 9 lines also at app/b.tsx:40"],
  );
  const alert = (path: string) => ({ rule: { id: "js/xss", description: "XSS" }, most_recent_instance: { location: { path, start_line: 12 }, message: { text: "flows" } } });
  assert.deepEqual(
    fromCodeql([[alert("api/a.ts")], [alert("api/b.ts")]]).map((a) => `${a.rule} ${a.path}:${a.line} ${a.message}`),
    ["js/xss api/a.ts:12 XSS: flows", "js/xss api/b.ts:12 XSS: flows"],
  );
});

test("a tool that looked at nothing is a failure, not a clean bill", () => {
  assert.throws(() => fromDepcruise({ summary: { totalCruised: 0, violations: [] } }), /no modules/);
  assert.throws(() => fromKnip({}), /no issue list/);
  assert.throws(() => fromJscpd({ statistics: { total: { sources: 0 } }, duplicates: [] }, "."), /no sources/);
  assert.throws(() => fromCodeql({ message: "no analysis found" }), /no analysis found/);
  assert.throws(() => fromCodeql([{ message: "no analysis found" }]), /no analysis found/);
});
