import { test } from "node:test";
import assert from "node:assert/strict";
import { gateTable, waitForRunEnd } from "../../scripts/bench-gates.mjs";
import { withBenchHost } from "../../scripts/ios-device.mjs";
import { benchLaunchHref } from "../../lib/diagnostics/benchLaunch.ts";

const RELEASE = { k: "build", t: 0, dev: false, scriptURL: "file:///var/x/murlan.app/main.jsbundle" };
const ran = (name: string) => [
  { session: "s", k: "scenario", t: 0, name, phase: "start" },
  { session: "s", k: "scenario", t: 1, name, phase: "end", error: null },
];

test("the wait returns only once the bench's run-end row has landed", async () => {
  const reads = [
    [{ k: "run", phase: "start", names: ["idle"] }],
    [{ k: "run", phase: "start", names: ["idle"] }, { k: "run", phase: "end", names: ["idle"] }],
  ];
  let calls = 0;
  const end = await waitForRunEnd(() => reads[Math.min(calls++, 1)], { pollMs: 0, timeoutMs: 1000 });
  assert.equal(calls, 2);
  assert.deepEqual(end, { names: ["idle"], timedOut: false });
  const never = await waitForRunEnd(() => reads[0], { pollMs: 0, timeoutMs: 5 });
  assert.deepEqual(never, { names: ["idle"], timedOut: true });
});

test("a scenario the run named but no rows judge is missing, and fails the table", () => {
  const rows = [{ session: "s", ...RELEASE }, ...ran("idle")];
  const { pass, markdown } = gateTable(rows, ["idle", "noticeGallery"]);
  assert.equal(pass, false);
  assert.match(markdown, /\| noticeGallery \| missing \|/);
  assert.match(markdown, /\| idle \| (fail|pass) \|/);
  assert.equal(gateTable(rows, []).pass, false);
});

test("a bench build starts the run at launch only when the install carried the PC's address", () => {
  assert.equal(benchLaunchHref({ benchHost: "192.168.1.23" }), "/bench?host=192.168.1.23&scenario=all");
  assert.equal(benchLaunchHref(undefined), null);
  assert.equal(benchLaunchHref({}), null);
  assert.equal(benchLaunchHref({ benchHost: "evil.example/x?" }), null);
  const config = JSON.parse(withBenchHost(JSON.stringify({ name: "Murlan", extra: { router: {} } }), "10.0.0.7"));
  assert.deepEqual(config, { name: "Murlan", extra: { router: {}, benchHost: "10.0.0.7" } });
});
