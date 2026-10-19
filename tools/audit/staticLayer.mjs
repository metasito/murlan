// The audit's tool layer: four analysers run at pinned versions, their output
// reduced to one alert shape for the workflow's investigators.
// node tools/audit/staticLayer.mjs --repo <checkout> --out <alerts.json> [--skip codeql,...]
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PRODUCTION = ['app', 'components', 'context', 'lib', 'server', 'shared'];
const ROOTS = [...PRODUCTION, 'tests', 'tools', 'scripts'];
const GH_REPO = process.env.GH_REPO ?? 'metasito/murlan';

const posix = (p) => p.replace(/\\/g, '/');

/** @typedef {{ tool: string, rule: string, path: string, line: number, message: string }} Alert */

/** @returns {Alert[]} */
export function fromDepcruise(report) {
  if (!report?.summary?.totalCruised) throw new Error('dependency-cruiser cruised no modules');
  return report.summary.violations.map((v) => ({
    tool: 'dependency-cruiser',
    rule: v.rule.name,
    path: v.from,
    line: 1,
    message: v.cycle ? `cycle: ${[v.from, ...v.cycle.map((c) => c.name)].join(' -> ')}` : `${v.from} -> ${v.to}`,
  }));
}

/** @returns {Alert[]} */
export function fromKnip(report) {
  if (!Array.isArray(report?.issues)) throw new Error('knip returned no issue list');
  return report.issues.flatMap((issue) =>
    Object.entries(issue)
      .filter(([, items]) => Array.isArray(items) && items.length)
      .flatMap(([kind, items]) => items.flat().map((item) => ({
        tool: 'knip',
        rule: kind,
        path: issue.file,
        line: item.line ?? 1,
        message: `${kind}: ${item.name}`,
      }))));
}

/** @returns {Alert[]} */
export function fromJscpd(report, repo) {
  if (!report?.statistics?.total?.sources) throw new Error('jscpd read no sources');
  const rel = (name) => posix(path.relative(repo, name.replace(/^[\\/]{2}\?[\\/]/, '')));
  return report.duplicates.map((d) => ({
    tool: 'jscpd',
    rule: 'clone',
    path: rel(d.firstFile.name),
    line: d.firstFile.start,
    message: `${d.lines} lines also at ${rel(d.secondFile.name)}:${d.secondFile.start}`,
  }));
}

/** @returns {Alert[]} `pages` is `gh api --paginate --slurp` output: one array per page. */
export function fromCodeql(pages) {
  if (!Array.isArray(pages) || !pages.every(Array.isArray)) {
    throw new Error(`code scanning returned ${JSON.stringify(pages).slice(0, 200)}`);
  }
  return pages.flat().map((a) => ({
    tool: 'codeql',
    rule: a.rule.id,
    path: a.most_recent_instance.location.path,
    line: a.most_recent_instance.location.start_line,
    message: `${a.rule.description}: ${a.most_recent_instance.message.text}`,
  }));
}

function run(command, repo, env = {}) {
  const r = spawnSync(command, { cwd: repo, shell: true, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, ...env } });
  if (r.error) throw r.error;
  if (!r.stdout.trim()) throw new Error(`${command.split(' ')[2]} printed nothing: ${r.stderr.slice(-500)}`);
  return r.stdout;
}

const TOOLS = {
  'dependency-cruiser': (repo) => fromDepcruise(JSON.parse(run(
    `npx --yes -p dependency-cruiser@18.5.0 -p typescript@6.0.3 depcruise --config "${fileURLToPath(new URL('depcruise.cjs', import.meta.url))}" --output-type json ${ROOTS.join(' ')}`, repo))),
  // drizzle.config.ts throws without DATABASE_URL; knip only loads it, never connects.
  knip: (repo) => fromKnip(JSON.parse(run('npx --yes knip@6.39.0 --reporter json --no-exit-code', repo,
    { DATABASE_URL: 'postgres://audit@127.0.0.1:1/none' }))),
  jscpd: (repo) => {
    const out = mkdtempSync(path.join(tmpdir(), 'jscpd-'));
    try {
      spawnSync(`npx --yes jscpd@5.4.0 --silent --absolute --reporters json --output "${out}" --min-tokens 70 --ignore "**/node_modules/**,**/*.json" ${PRODUCTION.join(' ')}`,
        { cwd: repo, shell: true, encoding: 'utf8' });
      return fromJscpd(JSON.parse(readFileSync(path.join(out, 'jscpd-report.json'), 'utf8')), repo);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  },
  codeql: (repo) => fromCodeql(JSON.parse(run(
    `gh api --paginate --slurp "repos/${GH_REPO}/code-scanning/alerts?state=open&ref=refs/heads/main&per_page=100"`, repo))),
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
  const repo = path.resolve(arg('--repo') ?? '.');
  const out = arg('--out');
  if (!out) throw new Error('--out <file> is required');
  const skip = process.argv.includes('--skip') ? arg('--skip').split(',') : [];
  const alerts = [];
  const failed = [];
  for (const [tool, collect] of Object.entries(TOOLS).filter(([tool]) => !skip.includes(tool))) {
    try {
      alerts.push(...collect(repo));
    } catch (error) {
      failed.push({ tool, error: String(error.message ?? error) });
    }
  }
  const counts = Object.fromEntries(Object.keys(TOOLS).map((t) => [t, alerts.filter((a) => a.tool === t).length]));
  writeFileSync(out, JSON.stringify({ alerts, counts, failed }, null, 1));
  console.log(JSON.stringify({ counts, failed }));
}
