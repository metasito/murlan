// The weekly mutation run's two decisions (.github/workflows/mutation.yml): which shards to run,
// and what the tracker is told about them.
//
//   node tools/ci/mutation.mjs shards                          → the matrix, as JSON
//   node tools/ci/mutation.mjs report <dir> <out.md> [run url] → exits 1 on a run that measured nothing
import { globSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";
import { MUTATE } from "../../stryker.config.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const DETECTED = ["Killed", "Timeout"];
const UNDETECTED = ["Survived", "NoCoverage"];
const COMMENT_LIMIT = 60000;

/** One shard per mutated file: a shard's time is then bounded by its own file, not the sum. */
export function shards(root = repoRoot) {
  return MUTATE.flatMap((pattern) => globSync(pattern, { cwd: root }))
    .map((file) => file.split(path.sep).join("/"))
    .sort()
    .map((file) => ({ file, slug: file.replace(/[^\w.-]/g, "-") }));
}

const oneLine = (text) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 80 ? `${flat.slice(0, 79)}…` : flat;
};
const code = (text) => (text.includes("`") ? `\`\` ${text} \`\`` : `\`${text}\``);

/**
 * @param {{ files: Record<string, { mutants: { mutatorName: string, replacement?: string, status: string, location: { start: { line: number } } }[] }> }[]} reports
 *   every shard's Stryker JSON report
 * @param {string[]} expected the mutated files, one per shard
 * @returns {{ markdown: string, ok: boolean }}
 */
export function summarize(reports, expected, runUrl = "") {
  const files = Object.assign({}, ...reports.map((r) => r.files));
  const errors = expected.filter((file) => !(file in files)).map((file) => `\`${file}\`: no report — its shard failed, or ran out of time.`);
  const rows = [];
  const survivors = [];
  let tested = 0;
  for (const file of Object.keys(files).sort()) {
    const count = (statuses) => files[file].mutants.filter((m) => statuses.includes(m.status)).length;
    const detected = count(DETECTED);
    const undetected = count(UNDETECTED);
    tested += detected + count(["Survived"]);
    const score = detected + undetected === 0 ? "—" : `${((100 * detected) / (detected + undetected)).toFixed(1)}%`;
    rows.push(`| \`${file}\` | ${score} | ${count(["Killed"])} | ${count(["Timeout"])} | ${count(["Survived"])} | ${count(["NoCoverage"])} |`);
    for (const m of files[file].mutants.filter((m) => UNDETECTED.includes(m.status)).sort((a, b) => a.location.start.line - b.location.start.line)) {
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
    const matrix = shards();
    if (matrix.length === 0) throw new Error(`no file matches ${MUTATE.join(", ")}`);
    process.stdout.write(JSON.stringify(matrix));
  } else if (command === "report" && dir && out) {
    const reports = globSync("**/mutation.json", { cwd: dir }).map((file) => JSON.parse(readFileSync(path.join(dir, file), "utf8")));
    const { markdown, ok } = summarize(reports, shards().map((s) => s.file), runUrl);
    writeFileSync(out, markdown);
    process.exitCode = ok ? 0 : 1;
  } else {
    throw new Error("usage: mutation.mjs shards | report <dir> <out.md> [run url]");
  }
}
