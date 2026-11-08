/**
 * The network half of RULES.md 53, run by .github/workflows/target-freeze.yml from the base branch's
 * checkout. It reads the pull request's head only as git objects, never as files to run, so a head
 * cannot loosen the list or the verdict that judges it.
 */
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";
import { firstLine, git } from "../loop/cli.mjs";

export const QUARANTINE = "tests/tooling/flakesAtSource.json";
export const TICKETED_DIRS = ["tests", "tools"];
export const SOURCE = /\.(?:tsx?|mjs|js)$/;
export const LABEL = "ci-flake";
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

/**
 * @param {import("../loop/cli.mjs").Git} at
 * @param {string} ref
 * @returns {Quarantine | null}
 */
function listAt(at, ref) {
  return at.text(["ls-tree", "--name-only", ref, "--", QUARANTINE]) ? JSON.parse(at.text(["show", `${ref}:${QUARANTINE}`])) : null;
}

/**
 * @param {import("../loop/cli.mjs").Git} at
 * @param {string} ref
 */
function tagsAt(at, ref) {
  const isSource = (/** @type {string} */ f) => SOURCE.test(f) && !f.split("/").includes("node_modules");
  const sources = at.text(["ls-tree", "-r", "-z", "--name-only", ref, "--", ...TICKETED_DIRS]).split("\0").filter(isSource).length;
  let hits = "";
  try {
    hits = at(["grep", "--null", "-I", "-E", "// flake: #[0-9]+", ref, "--", ...TICKETED_DIRS]);
  } catch (err) {
    if (err?.status !== 1) throw err;
  }
  const tags = hits
    .split("\n")
    .map((line) => line.split("\0"))
    .filter(([file, text]) => text !== undefined && isSource(file.slice(ref.length + 1)))
    .flatMap(([, text]) => ticketsIn(text));
  return { sources, tickets: [...new Set(tags)] };
}

/**
 * @param {string | undefined} base
 * @param {string | undefined} head
 * @param {{ at?: import("../loop/cli.mjs").Git, env?: Record<string, string | undefined>, fetch?: typeof fetch, log?: (line: string) => void }} [io]
 */
export async function run(base, head, { at = git(), env = process.env, fetch: get = fetch, log = console.log } = {}) {
  if (!base || !head) {
    log("::error::flake-tickets needs the base and head commits.");
    return 1;
  }
  if (!env.GITHUB_REPOSITORY || !env.GH_TOKEN) {
    log("::error::GITHUB_REPOSITORY and GH_TOKEN are both needed to read the tickets.");
    return 1;
  }
  const findings = [];
  let tickets;
  try {
    const found = tagsAt(at, head);
    if (found.sources < FLOOR) {
      log(`::error::only ${found.sources} sources under ${TICKETED_DIRS.join(", ")} at ${head}: that is not the tests.`);
      return 1;
    }
    tickets = found.tickets;
    const now = listAt(at, head);
    if (!now) {
      log(`::error::${head} has no ${QUARANTINE}, so there is nothing to hold to its base's.`);
      return 1;
    }
    let [then, from] = [listAt(at, base), base];
    if (!then) {
      if (!env.DEFAULT_BRANCH) {
        log(`::error::${base} has no ${QUARANTINE}, and no DEFAULT_BRANCH names a branch whose copy could stand in.`);
        return 1;
      }
      from = `origin/${env.DEFAULT_BRANCH}`;
      then = listAt(at, from);
    }
    if (then) findings.push(...grown(then, now));
    else log(`${QUARANTINE} is new: neither ${base} nor ${from} has one.`);
  } catch (err) {
    log(`::error::could not read ${base} or ${head}, so nothing was judged: ${firstLine(err)}`);
    return 1;
  }
  /** @param {string} at */
  const api = (at) =>
    get(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/${at}`, { headers: { authorization: `Bearer ${env.GH_TOKEN}`, accept: "application/vnd.github+json" } });
  const label = await api(`labels/${LABEL}`);
  if (label.status === 404) findings.push(`the ${LABEL} label does not exist; ask the owner to add ${LABEL}, so a flake ticket can carry it`);
  else if (!label.ok) findings.push(`the ${LABEL} label: HTTP ${label.status}`);
  for (const n of tickets) {
    const res = await api(`issues/${n}`);
    if (!res.ok) {
      findings.push(`#${n}: HTTP ${res.status}`);
      continue;
    }
    const issue = await res.json();
    if (issue.pull_request) findings.push(`#${n} is a pull request, not an issue`);
    else if (issue.state !== "open") findings.push(`#${n} is ${issue.state}: fix the test at its source, then drop its quarantine`);
    else if (!(issue.labels ?? []).some((/** @type {{name: string} | string} */ l) => (typeof l === "string" ? l : l.name) === LABEL)) findings.push(`#${n} has no ${LABEL} label`);
  }
  for (const f of findings) log(`::error::${f}`);
  log(`${tickets.length} flake tickets read, ${findings.length} findings`);
  return findings.length ? 1 : 0;
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) process.exitCode = await run(process.argv[2], process.argv[3]);
