import { readdirSync } from "node:fs";
import path from "node:path";

/** The suites' roots: a run that loads anything under one is answerable for everything under it. */
const ROOTS = ["tools/loop/tests", "tests"];

/**
 * Contract: one `test files run in <dir>: <n>` line per directory, which ci.yml's Test guard counts.
 * A file counts only when a test in it really ran — not skipped, not todo, and not the stand-in
 * node reports for a file that declared no test at all.
 *
 * It also fails the run when a `*.test.ts` under a root the run touched never loaded: a narrowed
 * glob drops whole directories and still exits 0.
 */
export default async function* filesRun(source) {
  const loaded = new Set();
  const ran = new Set();
  for await (const { type, data } of source) {
    if (!data?.file) continue;
    loaded.add(data.file);
    if (type === "test:fail") ran.add(data.file);
    const standIn = path.resolve(data.name ?? "") === path.resolve(data.file);
    if (type === "test:pass" && !data.skip && !data.todo && !standIn) ran.add(data.file);
  }
  const perDir = new Map();
  for (const file of ran) {
    const dir = path.relative(process.cwd(), path.dirname(file)).split(path.sep).join("/");
    perDir.set(dir, (perDir.get(dir) ?? 0) + 1);
  }
  for (const [dir, count] of [...perDir].sort()) yield `test files run in ${dir}: ${count}\n`;

  const missing = unloaded([...loaded]);
  if (loaded.size === 0) missing.push("(no test file loaded at all)");
  for (const file of missing) yield `test file never loaded: ${file}\n`;
  if (missing.length > 0) process.exitCode = 1;
}

/** @param {string[]} loaded absolute paths */
export function unloaded(loaded, cwd = process.cwd()) {
  const rel = loaded.map((f) => path.relative(cwd, f).split(path.sep).join("/"));
  return ROOTS.filter((root) => rel.some((f) => f.startsWith(`${root}/`))).flatMap((root) =>
    readdirSync(path.join(cwd, root), { recursive: true, encoding: "utf8" })
      .map((f) => `${root}/${f.split(path.sep).join("/")}`)
      .filter((f) => f.endsWith(".test.ts") && !rel.includes(f))
  );
}
