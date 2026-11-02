// The runtime each pinned GitHub Action declares at its SHA, recorded in tests/fixtures/actionRuntimes.json
// so tests/tooling/ciWorkflowsPinned.test.ts can judge it offline.
//
// Usage: node scripts/refresh-action-runtimes.mjs           rewrite the record from GitHub
//        node scripts/refresh-action-runtimes.mjs --check   exit 1 if the record differs from GitHub
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isInvokedDirectly } from "./lib/entry.mjs";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const RECORD = "tests/fixtures/actionRuntimes.json";
export const RUNTIMES = new Set(["node24", "composite", "docker"]);
export const USES = /^\s*(?:-\s+)?uses:\s*(.*)$/;
const REMOTE = /^([\w.-]+)\/([\w.-]+)((?:\/[\w.-]+)*)@([0-9a-f]{40})$/;

export function workflowFiles() {
  return readdirSync(path.join(repoRoot, ".github/workflows"))
    .filter((name) => /\.ya?ml$/.test(name))
    .map((name) => `.github/workflows/${name}`);
}

export function actionFiles() {
  return readdirSync(path.join(repoRoot, ".github/actions")).flatMap((action) =>
    ["action.yml", "action.yaml"]
      .map((name) => `.github/actions/${action}/${name}`)
      .filter((file) => existsSync(path.join(repoRoot, file))),
  );
}

/** @param {string} source */
export function remoteActions(source) {
  return source
    .split(/\r?\n/)
    .map((line) => USES.exec(line)?.[1].split(/\s+#/)[0].replace(/["']/g, "").trim())
    .filter(/** @returns {ref is string} */ (ref) => ref !== undefined && REMOTE.test(ref));
}

export function pinnedActions() {
  const files = [...workflowFiles(), ...actionFiles()];
  return [...new Set(files.flatMap((file) => remoteActions(readFileSync(path.join(repoRoot, file), "utf8"))))].sort();
}

/** @param {string} actionYml */
export function runtimeOf(actionYml) {
  const runs = /^runs:[^\n]*\n((?:[ \t]*(?:[ \t][^\n]*)?(?:\n|$))*)/m.exec(actionYml)?.[1];
  return runs === undefined ? undefined : /^[ \t]+using:\s*["']?([\w-]+)/m.exec(runs)?.[1];
}

/** @param {string} ref */
async function fetchActionYml(ref) {
  const [, owner, repo, sub, sha] = REMOTE.exec(ref);
  for (const name of ["action.yml", "action.yaml"]) {
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/${sha}${sub}/${name}`;
    for (let attempt = 1; ; attempt++) {
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) }).catch((error) => error);
      if (!(response instanceof Error) && response.ok) return response.text();
      if (!(response instanceof Error) && response.status === 404) break;
      if (attempt === 3) throw new Error(`${url}: ${response instanceof Error ? response.message : response.status}`);
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
  throw new Error(`${ref} has no action.yml or action.yaml`);
}

/**
 * Each ref's declared runtime, the remote actions a composite runs included.
 * @param {string[]} refs
 * @returns {Promise<Record<string, string>>}
 */
export async function resolveRuntimes(refs) {
  const record = {};
  let next = [...new Set(refs)];
  while (next.length > 0) {
    const actions = await Promise.all(next.map(async (ref) => ({ ref, yml: await fetchActionYml(ref) })));
    next = [];
    for (const { ref, yml } of actions) {
      const using = runtimeOf(yml) ?? "unread";
      record[ref] = using;
      if (using === "composite") next.push(...remoteActions(yml).filter((child) => !(child in record)));
    }
    next = [...new Set(next)];
  }
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}

async function main() {
  const live = await resolveRuntimes(pinnedActions());
  const file = path.join(repoRoot, RECORD);
  const text = `${JSON.stringify(live, null, 2)}\n`;
  if (!process.argv.includes("--check")) {
    writeFileSync(file, text);
    console.log(`${RECORD}: ${Object.keys(live).length} actions`);
    return;
  }
  const recorded = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (recorded === text) {
    console.log(`${RECORD} matches GitHub for ${Object.keys(live).length} actions`);
    return;
  }
  console.error(`${RECORD} differs from what GitHub serves at the pinned SHAs. GitHub says:\n${text}`);
  process.exitCode = 1;
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) await main();
