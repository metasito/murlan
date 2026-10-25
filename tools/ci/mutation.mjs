// The weekly mutation run's two decisions (.github/workflows/mutation.yml): which shards to run,
// and what the tracker is told about them.
//
//   node tools/ci/mutation.mjs shards                      → the matrix, as JSON
//   MUTATION_SHARDS=<matrix> node tools/ci/mutation.mjs report <dir> <out.md> [run url]
//                                                          → exits 1 on a shard that measured nothing
import { existsSync, globSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";
import { MUTATE } from "../../stryker.config.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const DETECTED = ["Killed", "Timeout"];
const UNDETECTED = ["Survived", "NoCoverage"];
const COMMENT_LIMIT = 60000;

/**
 * The most mutants one shard holds. A shard must fit its hour cold: GitHub evicts a cache untouched for
 * 7 days, which a weekly run sits on the edge of, so --incremental cannot be counted on.
 */
export const SHARD_MUTANTS = 150;

const SILENT = { debug() {}, info() {}, warn() {}, error() {}, trace() {}, fatal() {}, isDebugEnabled: () => false, isTraceEnabled: () => false };

/** Line ranges of `lines` holding at most `budget` mutants each, cut only where no mutant spans the cut. */
function rangesOf(lines, spans, budget) {
  const startingAt = new Map();
  const uncuttable = new Set();
  for (const [start, end] of spans) {
    startingAt.set(start, (startingAt.get(start) ?? 0) + 1);
    for (let line = start; line < end; line++) uncuttable.add(line);
  }
  const atoms = [];
  let atom = { start: 1, mutants: 0 };
  for (let line = 1; line <= lines; line++) {
    atom.mutants += startingAt.get(line) ?? 0;
    if (!uncuttable.has(line) || line === lines) {
      atoms.push({ ...atom, end: line });
      atom = { start: line + 1, mutants: 0 };
    }
  }
  const ranges = [];
  for (const next of atoms) {
    const last = ranges.at(-1);
    if (last && (last.mutants + next.mutants <= budget || next.mutants === 0)) Object.assign(last, { end: next.end, mutants: last.mutants + next.mutants });
    else if (last && last.mutants === 0) Object.assign(last, { end: next.end, mutants: next.mutants });
    else ranges.push({ ...next });
  }
  return ranges;
}

/**
 * Every mutated file's lines, cut into ranges by the mutants Stryker places in them. A file with no
 * mutant gets no shard: it would report nothing every week.
 */
export async function shards(root = repoRoot, budget = SHARD_MUTANTS) {
  const { Instrumenter } = await import("@stryker-mutator/instrumenter");
  const files = MUTATE.flatMap((pattern) => globSync(pattern, { cwd: root }))
    .map((file) => file.split(path.sep).join("/"))
    .sort();
  const sources = files.map((name) => ({ name, mutate: true, content: readFileSync(path.join(root, name), "utf8") }));
  const { mutants } = await new Instrumenter(SILENT).instrument(sources, { plugins: null, excludedMutations: [], ignorers: [] });
  return sources.flatMap(({ name: file, content }) => {
    const spans = mutants.filter((m) => m.fileName === file).map((m) => [m.location.start.line + 1, m.location.end.line + 1]);
    if (spans.length === 0) return [];
    const slug = file.replace(/[^\w.-]/g, "-");
    return rangesOf(content.split("\n").length, spans, budget).map(({ start, end, mutants: count }, i) => ({
      file,
      start,
      end,
      mutants: count,
      mutate: `${file}:${start}-${end}`,
      slug: `${slug}-${i + 1}`,
    }));
  });
}

const oneLine = (text) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 80 ? `${flat.slice(0, 79)}…` : flat;
};
const code = (text) => (text.includes("`") ? `\`\` ${text} \`\`` : `\`${text}\``);

/**
 * @typedef {{ mutatorName: string, replacement?: string, status: string, location: { start: { line: number } } }} Mutant
 * @param {{ slug: string, report: { files: Record<string, { mutants: Mutant[] }> } }[]} reports every shard's Stryker JSON report
 * @param {{ slug: string, mutate: string }[]} expected every shard the run started
 * @returns {{ markdown: string, ok: boolean }}
 */
export function summarize(reports, expected, runUrl = "") {
  const reported = new Set(reports.map((r) => r.slug));
  const errors = expected.filter((s) => !reported.has(s.slug)).map((s) => `\`${s.mutate}\`: no report — its shard failed before Stryker wrote one.`);
  const isTested = (m) => DETECTED.includes(m.status) || m.status === "Survived";
  for (const { slug, report } of reports) {
    const held = Object.values(report.files).flatMap((f) => f.mutants);
    if (held.length > 0 && !held.some(isTested)) {
      const name = expected.find((s) => s.slug === slug)?.mutate ?? slug;
      errors.push(`\`${name}\`: ${held.length} mutants, none tested.`);
    }
  }
  /** @type {Record<string, Mutant[]>} */
  const files = {};
  for (const { report } of reports) {
    for (const [file, { mutants }] of Object.entries(report.files)) (files[file] ??= []).push(...mutants);
  }
  const rows = [];
  const survivors = [];
  let tested = 0;
  for (const file of Object.keys(files).sort()) {
    const count = (statuses) => files[file].filter((m) => statuses.includes(m.status)).length;
    const detected = count(DETECTED);
    const undetected = count(UNDETECTED);
    tested += files[file].filter(isTested).length;
    const score = detected + undetected === 0 ? "—" : `${((100 * detected) / (detected + undetected)).toFixed(1)}%`;
    rows.push(`| \`${file}\` | ${score} | ${count(["Killed"])} | ${count(["Timeout"])} | ${count(["Survived"])} | ${count(["NoCoverage"])} |`);
    for (const m of files[file].filter((m) => UNDETECTED.includes(m.status)).sort((a, b) => a.location.start.line - b.location.start.line)) {
      const unrun = m.status === "NoCoverage" ? " (no test runs it)" : "";
      survivors.push(`- \`${file}:${m.location.start.line}\` ${m.mutatorName} → ${code(oneLine(m.replacement ?? ""))}${unrun}`);
    }
  }
  if (tested === 0) errors.push("No mutant was tested: an error, not a perfect score.");

  const head = [
    `Mutation run${runUrl ? ` ([run](${runUrl}))` : ""}: ${tested} mutants tested, ${survivors.length} undetected.`,
    ...(errors.length ? ["", "**The run failed:**", ...errors.map((e) => `- ${e}`)] : []),
    "",
    "| File | Score | Killed | Timed out | Survived | No coverage |",
    "|---|---|---|---|---|---|",
    ...rows,
    "",
    "**Survivors** — a line whose behaviour no test asserts:",
  ].join("\n");
  const listed = [];
  let length = head.length;
  for (const line of survivors) {
    if (length + line.length + 1 > COMMENT_LIMIT) break;
    listed.push(line);
    length += line.length + 1;
  }
  const cut = survivors.length - listed.length;
  const tail = cut ? [`- …and ${cut} more: every shard's \`mutation.json\` is in the run's artifacts.`] : survivors.length ? [] : ["- none"];
  return { markdown: [head, ...listed, ...tail, ""].join("\n"), ok: errors.length === 0 };
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  const [command, dir, out, runUrl] = process.argv.slice(2);
  if (command === "shards") {
    const matrix = await shards();
    if (matrix.length === 0) throw new Error(`no mutant in ${MUTATE.join(", ")}`);
    process.stdout.write(JSON.stringify(matrix));
  } else if (command === "report" && dir && out) {
    const expected = JSON.parse(process.env.MUTATION_SHARDS || "[]");
    if (expected.length === 0) throw new Error("MUTATION_SHARDS names no shard: the run's shard list is lost");
    // Each artifact is downloaded into its own mutation-<slug> directory.
    const reports = (existsSync(dir) ? readdirSync(dir) : []).map((name) => ({
      slug: name.replace(/^mutation-/, ""),
      report: JSON.parse(readFileSync(path.join(dir, name, "mutation.json"), "utf8")),
    }));
    const { markdown, ok } = summarize(reports, expected, runUrl);
    writeFileSync(out, markdown);
    process.exitCode = ok ? 0 : 1;
  } else {
    throw new Error("usage: mutation.mjs shards | report <dir> <out.md> [run url]");
  }
}
