// `npm run toolchain`: whether this machine runs the toolchain the repo is pinned to, and which
// differences it is silently absorbing. Exit 1 on a difference that changes results; `--inform`
// (the SessionStart hook) prints the same and always exits 0.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isInvokedDirectly } from "./lib/entry.mjs";

const BROWSER_DIRS = { chromium: "chromium", "chromium-headless-shell": "chromium_headless_shell", ffmpeg: "ffmpeg" };

/**
 * @param {{
 *   node: string, wantNodeMajor: number,
 *   wantedBrowsers: { name: string, revision: string }[],
 *   browserState: (dir: string) => "present" | { aliasOf: string } | { copyOf: string } | "missing",
 *   dockerUp: boolean,
 * }} facts
 * @returns {{ level: "error" | "warn", text: string }[]}
 */
export function toolchainFindings({ node, wantNodeMajor, wantedBrowsers, browserState, dockerUp }) {
  const findings = [];
  if (Number(node.split(".")[0]) !== wantNodeMajor) {
    findings.push({ level: "error", text: `Node ${node} runs here; deploy/runtime.json and .node-version pin ${wantNodeMajor}. Tests and plants can pass here and fail in CI.` });
  }
  for (const name of Object.keys(BROWSER_DIRS)) {
    if (!wantedBrowsers.some((b) => b.name === name)) findings.push({ level: "error", text: `playwright-core lists no ${name} build: nothing here would have checked it.` });
  }
  for (const { name, revision } of wantedBrowsers) {
    const dir = `${BROWSER_DIRS[name]}-${revision}`;
    const state = browserState(dir);
    if (state === "missing") findings.push({ level: "error", text: `${name} ${revision} (${dir}) is not installed: \`npx playwright install ${name}\`.` });
    else if (state !== "present") {
      const [how, of] = "aliasOf" in state ? ["an alias", state.aliasOf] : ["a copy", state.copyOf];
      findings.push({ level: "warn", text: `${dir} is ${how} of ${of}: e2e results here come from a different browser build than CI's.` });
    }
  }
  if (!dockerUp) findings.push({ level: "warn", text: "the docker daemon is not answering; e2e and the integration stack need it (start it by hand in a cloud container)." });
  return findings;
}

/** The hash of the largest file under `dir`: the browser binary, which two revisions never share. */
function fingerprint(dir) {
  let biggest = { size: -1, file: "" };
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const file = path.join(d, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && statSync(file).size > biggest.size) biggest = { size: statSync(file).size, file };
    }
  };
  walk(dir);
  return biggest.file ? createHash("sha256").update(readFileSync(biggest.file)).digest("hex") : undefined;
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const require = createRequire(path.join(root, "package.json"));
  const wantNodeMajor = JSON.parse(readFileSync(path.join(root, "deploy", "runtime.json"), "utf8")).node;
  const browsers = JSON.parse(readFileSync(path.join(path.dirname(require.resolve("playwright-core/package.json")), "browsers.json"), "utf8")).browsers;
  const store = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(os.homedir(), ".cache", "ms-playwright");
  const findings = toolchainFindings({
    node: process.versions.node,
    wantNodeMajor,
    wantedBrowsers: browsers.filter((b) => b.name in BROWSER_DIRS),
    browserState: (dir) => {
      const at = path.join(store, dir);
      if (!existsSync(at)) return "missing";
      if (lstatSync(at).isSymbolicLink()) return { aliasOf: path.basename(realpathSync(at)) };
      const kind = dir.slice(0, dir.lastIndexOf("-") + 1);
      const mine = fingerprint(at);
      const twin = readdirSync(store).find((d) => d !== dir && d.startsWith(kind) && fingerprint(path.join(store, d)) === mine);
      return twin && mine ? { copyOf: twin } : "present";
    },
    dockerUp: spawnSync("docker", ["info"], { stdio: "ignore", timeout: 15_000 }).status === 0,
  });
  for (const { level, text } of findings) console.log(`${level}: ${text}`);
  if (findings.length === 0) console.log("toolchain: as pinned");
  process.exit(!process.argv.includes("--inform") && findings.some((f) => f.level === "error") ? 1 : 0);
}
