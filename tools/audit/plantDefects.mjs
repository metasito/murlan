// Builds the audit's calibration checkout: `sha` with the production half of up
// to `count` past bug fixes reverted, each one a defect whose location is known.
// The audit is then run against it, blind, and scored on how many it finds.
// node tools/audit/plantDefects.mjs --repo <checkout> --sha <sha> --into <dir> [--count 10]
// node tools/audit/plantDefects.mjs --score <dir>.planted.json --judged <judged.json>
// Remove the result with `npm run worktrees:remove -- <dir>` (docs/agents/RULES.md 39).
import { execFileSync } from 'node:child_process';
import { readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PRODUCTION = ['app', 'components', 'context', 'lib', 'server', 'shared'];
const MAX_CHANGED_LINES = 60;

/** The new-side line span of every hunk in a `git diff -U0`, by file. */
export function hunkRanges(diff) {
  const ranges = [];
  let file = null;
  for (const line of diff.split('\n')) {
    const header = /^\+\+\+ b\/(.+)$/.exec(line);
    if (header) file = header[1];
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk && file) {
      const start = Number(hunk[1]);
      const length = hunk[2] === undefined ? 1 : Number(hunk[2]);
      ranges.push({ path: file, start: Math.max(1, start), end: Math.max(1, start, start + length - 1) });
    }
  }
  return ranges;
}

/** Whether a finding's locations land on a planted defect, within `slack` lines. */
export function catches(finding, plant, slack = 10) {
  return finding.locations.some((loc) =>
    plant.locations.some((p) => p.path === loc.path && loc.line >= p.start - slack && loc.line <= p.end + slack));
}

/**
 * Recall over the planted defects, and how many the skeptics talked the audit out of.
 * @returns {{ planted: number, caught: number, refuted: number, recall: number | null,
 *   rows: { issue: number, title: string, verdict: 'caught' | 'refuted' | 'missed', findings: string[] }[] }}
 */
export function score(planted, judged) {
  const rows = planted.map((plant) => {
    const hits = judged.filter((f) => catches(f, plant));
    const verdict = hits.some((f) => f.verdict !== 'refuted') ? 'caught' : hits.length ? 'refuted' : 'missed';
    return { issue: plant.issue, title: plant.title, verdict, findings: hits.map((f) => f.title) };
  });
  const caught = rows.filter((r) => r.verdict === 'caught').length;
  return { planted: rows.length, caught, refuted: rows.filter((r) => r.verdict === 'refuted').length, recall: rows.length ? caught / rows.length : null, rows };
}

const sh = (cwd, args, input) =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', input, stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 });
const gh = (args) => JSON.parse(execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));

const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain && arg('--score')) {
  const read = (file) => JSON.parse(readFileSync(file, 'utf8'));
  console.log(JSON.stringify(score(read(arg('--score')).planted, read(arg('--judged'))), null, 1));
} else if (isMain) {
  const repo = path.resolve(arg('--repo', '.'));
  const sha = arg('--sha');
  const into = path.resolve(arg('--into'));
  const count = Number(arg('--count', 10));
  if (!sha || !arg('--into')) throw new Error('--sha and --into are required');

  const bugs = new Map(gh(['issue', 'list', '--state', 'closed', '--label', 'bug', '--limit', '500', '--json', 'number,title']).map((i) => [i.number, i.title]));
  const prs = gh(['pr', 'list', '--state', 'merged', '--limit', '1000', '--json', 'number,mergeCommit,closingIssuesReferences'])
    .map((pr) => ({ pr: pr.number, merge: pr.mergeCommit?.oid, issue: pr.closingIssuesReferences.map((i) => i.number).find((n) => bugs.has(n)) }))
    .filter((pr) => pr.merge && pr.issue);

  sh(repo, ['worktree', 'add', '--detach', into, sha]);
  symlinkSync(path.join(repo, 'node_modules'), path.join(into, 'node_modules'), 'junction');

  const planted = [];
  const touched = new Set();
  for (const { pr, merge, issue } of prs) {
    if (planted.length >= count) break;
    const fix = sh(repo, ['diff', '-U3', `${merge}^1`, merge, '--', ...PRODUCTION]);
    const files = [...fix.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((m) => m[1]);
    const changed = fix.split('\n').filter((l) => /^[+-][^+-]/.test(l)).length;
    if (!files.length || changed > MAX_CHANGED_LINES || files.some((f) => touched.has(f))) continue;
    try {
      sh(into, ['apply', '-R', '--check'], fix);
    } catch {
      continue;
    }
    sh(into, ['apply', '-R'], fix);
    const locations = hunkRanges(sh(into, ['diff', '-U0']));
    sh(into, ['add', '-A', '--', ...files]);
    sh(into, ['-c', 'user.name=audit', '-c', 'user.email=audit@localhost', 'commit', '-q', '-m', 'snapshot']);
    files.forEach((f) => touched.add(f));
    planted.push({ issue, pr, title: bugs.get(issue), locations });
  }
  sh(into, ['reset', '--soft', sha]);
  sh(into, ['-c', 'user.name=audit', '-c', 'user.email=audit@localhost', 'commit', '-q', '-m', 'snapshot']);
  const head = sh(into, ['rev-parse', 'HEAD']).trim();
  const out = path.join(path.dirname(into), `${path.basename(into)}.planted.json`);
  writeFileSync(out, JSON.stringify({ repo: into, sha: head, base: sha, planted }, null, 1));
  console.log(JSON.stringify({ repo: into, sha: head, planted: planted.length, record: out }));
}
