import { test } from "node:test";
import assert from "node:assert/strict";
import { fromCodeql, fromDepcruise, fromJscpd, fromKnip } from "../../tools/audit/staticLayer.mjs";

test("each tool's output becomes path:line alerts", () => {
  assert.deepEqual(
    fromDepcruise({ summary: { totalCruised: 3, violations: [{ from: "shared/a.ts", to: "lib/b.ts", rule: { name: "shared-is-a-leaf" } }] } }),
    [{ tool: "dependency-cruiser", rule: "shared-is-a-leaf", path: "shared/a.ts", line: 1, message: "shared/a.ts -> lib/b.ts" }],
  );
  assert.deepEqual(
    fromKnip({ issues: [{ file: "lib/x.ts", exports: [{ name: "unused", line: 7 }], duplicates: [[{ name: "A", line: 2 }, { name: "B", line: 3 }]], types: [] }] })
      .map((a) => `${a.rule} ${a.path}:${a.line} ${a.message}`),
    ["exports lib/x.ts:7 exports: unused", "duplicates lib/x.ts:2 duplicates: A", "duplicates lib/x.ts:3 duplicates: B"],
  );
  assert.deepEqual(
    fromJscpd({ statistics: { total: { sources: 2 } }, duplicates: [{ lines: 9, firstFile: { name: "\\\\?\\C:\\r\\app\\a.tsx", start: 4 }, secondFile: { name: "C:\\r\\app\\b.tsx", start: 40 } }] }, "C:\\r")
      .map((a) => `${a.path}:${a.line} ${a.message}`),
    ["app/a.tsx:4 9 lines also at app/b.tsx:40"],
  );
  const alert = (path: string) => ({ rule: { id: "js/xss", description: "XSS" }, most_recent_instance: { location: { path, start_line: 12 }, message: { text: "flows" } } });
  assert.deepEqual(
    fromCodeql([[alert("server/a.ts")], [alert("server/b.ts")]]).map((a) => `${a.rule} ${a.path}:${a.line} ${a.message}`),
    ["js/xss server/a.ts:12 XSS: flows", "js/xss server/b.ts:12 XSS: flows"],
  );
});

test("a tool that looked at nothing is a failure, not a clean bill", () => {
  assert.throws(() => fromDepcruise({ summary: { totalCruised: 0, violations: [] } }), /no modules/);
  assert.throws(() => fromKnip({}), /no issue list/);
  assert.throws(() => fromJscpd({ statistics: { total: { sources: 0 } }, duplicates: [] }, "."), /no sources/);
  assert.throws(() => fromCodeql({ message: "no analysis found" }), /no analysis found/);
  assert.throws(() => fromCodeql([{ message: "no analysis found" }]), /no analysis found/);
});
