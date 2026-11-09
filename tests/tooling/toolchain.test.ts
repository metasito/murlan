import { test } from "node:test";
import assert from "node:assert/strict";
import { toolchainFindings } from "../../scripts/toolchain.mjs";

const wantedBrowsers = [{ name: "chromium", revision: "1248" }, { name: "ffmpeg", revision: "1013" }];
const asPinned = { node: "26.1.0", wantNodeMajor: 26, wantedBrowsers, browserState: () => "present" as const, dockerUp: true };

test("a machine as pinned has nothing to report", () => {
  assert.deepEqual(toolchainFindings(asPinned), []);
});

test("another Node major is an error", () => {
  const [found] = toolchainFindings({ ...asPinned, node: "22.23.4" });
  assert.equal(found!.level, "error");
  assert.match(found!.text, /22\.23\.4.*pin 26/);
});

test("a browser build that is an alias of another is named, and one that is missing is an error", () => {
  const findings = toolchainFindings({
    ...asPinned,
    browserState: (dir) => (dir === "chromium-1248" ? { aliasOf: "chromium-1243" } : "missing"),
  });
  assert.deepEqual(findings.map((f) => f.level), ["warn", "error"]);
  assert.match(findings[0]!.text, /chromium-1248 is an alias of chromium-1243/);
  assert.match(findings[1]!.text, /ffmpeg-1013/);
});

test("a docker daemon that does not answer is reported", () => {
  assert.match(toolchainFindings({ ...asPinned, dockerUp: false })[0]!.text, /docker daemon/);
});
