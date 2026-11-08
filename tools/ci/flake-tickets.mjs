/**
 * The network half of tests/tooling/flakesAtSource.test.ts, run by ci.yml's CI gate: every
 * flake tag names an open issue, and the quarantine list holds no more than the base's.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";

export const QUARANTINE = "tests/tooling/flakesAtSource.json";
export const TICKETED_DIRS = ["tests", "tools"];
const SOURCE = /\.(?:tsx?|mjs|js)$/;
const FLOOR = 100;

/** @param {string} text */
export const ticketsIn = (text) => [...text.matchAll(/\/\/ flake: #(\d+)\b/g)].map((m) => Number(m[1]));

/** @typedef {Record<string, Record<string, number>>} Quarantine kind -> file -> sites left unheard */

/**
 * @param {Quarantine} base
 * @param {Quarantine} head
 */
export function grown(base, head) {
  return Object.entries(head).flatMap(([kind, files]) =>
    Object.entries(files)
      .filter(([file, n]) => n > (base?.[kind]?.[file] ?? 0))
      .map(([file, n]) => `${QUARANTINE} ${kind}: ${file} went from ${base?.[kind]?.[file] ?? 0} to ${n}; it only shrinks`),
  );
}

/** @param {string} root */
export function sources(root) {
  return TICKETED_DIRS.flatMap((dir) =>
    readdirSync(path.join(root, dir), { recursive: true, encoding: "utf8" })
      .filter((f) => SOURCE.test(f) && !f.split(path.sep).includes("node_modules"))
      .map((f) => readFileSync(path.join(root, dir, f), "utf8")),
  );
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {{ fetch?: typeof fetch, log?: (line: string) => void, root?: string }} [io]
 */
export async function run(env, { fetch: get = fetch, log = console.log, root = process.cwd() } = {}) {
  if (!env.GITHUB_REPOSITORY || !env.GH_TOKEN) {
    log("GITHUB_REPOSITORY and GH_TOKEN are both needed");
    return 1;
  }
  /** @param {string} at @param {string} [accept] */
  const api = (at, accept = "application/vnd.github+json") =>
    get(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/${at}`, { headers: { authorization: `Bearer ${env.GH_TOKEN}`, accept } });
  const files = sources(root);
  if (files.length < FLOOR) {
    log(`only ${files.length} sources under ${TICKETED_DIRS.join(", ")}: the checkout does not hold the tests`);
    return 1;
  }
  const findings = [];
  const base = /^0*$/.test(env.BASE ?? "") ? "" : env.BASE;
  if (base) {
    const res = await api(`contents/${QUARANTINE}?ref=${base}`, "application/vnd.github.raw+json");
    if (res.status === 404) log(`${QUARANTINE} is new since ${base}`);
    else if (!res.ok) {
      log(`reading ${QUARANTINE} at ${base}: HTTP ${res.status}`);
      return 1;
    } else findings.push(...grown(JSON.parse(await res.text()), JSON.parse(readFileSync(path.join(root, QUARANTINE), "utf8"))));
  } else if (env.EVENT === "pull_request") {
    log("a pull request with no base commit to hold the quarantine list against");
    return 1;
  } else log("no base commit: the quarantine list is held only to its exact count");
  const tickets = [...new Set(files.flatMap(ticketsIn))];
  for (const n of tickets) {
    const res = await api(`issues/${n}`);
    if (!res.ok) {
      findings.push(`#${n}: HTTP ${res.status}`);
      continue;
    }
    const issue = await res.json();
    if (issue.pull_request) findings.push(`#${n} is a pull request, not an issue`);
    else if (issue.state !== "open") findings.push(`#${n} is ${issue.state}: fix the test at its source, then drop its quarantine`);
  }
  for (const f of findings) log(`::error::${f}`);
  log(`${tickets.length} flake tickets read, ${findings.length} findings`);
  return findings.length ? 1 : 0;
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) process.exitCode = await run(process.env);
