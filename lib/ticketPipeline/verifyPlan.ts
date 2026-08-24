// lib/ticketPipeline/verifyPlan.ts
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export interface VerifyJobs {
  verify: boolean;
  native: boolean;
  browser: boolean;
  build: boolean;
}

// Paths that cannot reach the app bundle, the server, or a browser. This is an allowlist, the
// same shape ci.yml's scope job uses, so an unrecognised path falls through to the full sweep
// rather than quietly skipping the check that would have caught it.
const CANNOT_REACH_THE_APP = [
  /^\.claude\//,
  /^docs\//,
  /^lib\/ticketPipeline\//,
  /^tests\//,
  /\.md$/,
];

const NEEDS_BROWSER = /^tests\/e2e\//;
const NEEDS_NATIVE = /^tests\/native\//;

export function pickVerifyJobs(filesTouched: string[]): VerifyJobs {
  const files = filesTouched.map((f) => f.replace(/\\/g, "/"));
  const touchesApp = files.some((f) => !CANNOT_REACH_THE_APP.some((p) => p.test(f)));
  return {
    verify: true,
    native: touchesApp || files.some((f) => NEEDS_NATIVE.test(f)),
    browser: touchesApp || files.some((f) => NEEDS_BROWSER.test(f)),
    build: touchesApp,
  };
}

// Input arrives on stdin, never as an argv token: a caller's shell layer collapses the `\\`
// that JSON.stringify emits for a literal backslash, which makes the payload unparseable.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = JSON.parse(readFileSync(0, "utf8").trim() || "[]");
  process.stdout.write(JSON.stringify(pickVerifyJobs(input)));
}
