import { test } from "node:test";
import assert from "node:assert/strict";

// Integration tests boot the real server. That is only possible if every server
// module loads under Node's native type-stripping — no bundler, no path aliases.
const MODULES = [
  "logger", "db", "session", "cors", "validate", "schemas",
  "socketSchemas", "socketSafety", "ticket", "storage", "onlineGameLogic",
];

for (const name of MODULES) {
  test(`server/${name}.ts is loadable by plain Node`, async () => {
    const mod = await import(`../server/${name}.ts`);
    assert.ok(mod, `server/${name}.ts failed to load`);
  });
}
